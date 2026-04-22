use crate::auth;
use crate::error::{Error, Result};
use crate::github::{self, Issue, IssueComment, NewIssueInput, Repo, RepoLabel, User};
use crate::notify;
use crate::projects::{self, ProjectSnapshot, ProjectSummary};
use tauri::Emitter;
use crate::sources::{self, Settings, Source};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

/// Shared state: HTTP client reused across commands.
pub struct AppState {
    pub http: reqwest::Client,
}

#[derive(Debug, Serialize)]
pub struct AuthStatus {
    pub authenticated: bool,
    pub user: Option<User>,
}

async fn require_token() -> Result<String> {
    auth::load_token()?.ok_or(Error::NotAuthenticated)
}

#[tauri::command]
pub async fn auth_status(state: State<'_, AppState>) -> Result<AuthStatus> {
    match auth::load_token()? {
        Some(token) => match github::get_authenticated_user(&state.http, &token).await {
            Ok(user) => Ok(AuthStatus {
                authenticated: true,
                user: Some(user),
            }),
            Err(Error::GitHub { status, .. }) if status == 401 => {
                // Token revoked; wipe it.
                let _ = auth::clear_token();
                Ok(AuthStatus {
                    authenticated: false,
                    user: None,
                })
            }
            Err(e) => Err(e),
        },
        None => Ok(AuthStatus {
            authenticated: false,
            user: None,
        }),
    }
}

#[tauri::command]
pub async fn auth_start(state: State<'_, AppState>) -> Result<auth::DeviceCode> {
    auth::start_device_flow(&state.http).await
}

#[derive(Debug, Serialize)]
pub struct AuthPollResult {
    pub done: bool,
    /// If GitHub asked us to slow down, the new minimum interval in seconds.
    /// Frontend should reschedule its polling timer to this.
    pub new_interval: Option<u64>,
}

#[tauri::command]
pub async fn auth_poll(
    state: State<'_, AppState>,
    device_code: String,
) -> Result<AuthPollResult> {
    match auth::poll_for_token(&state.http, &device_code).await? {
        auth::PollOutcome::Token(token) => {
            auth::store_token(&token)?;
            Ok(AuthPollResult {
                done: true,
                new_interval: None,
            })
        }
        auth::PollOutcome::Pending { new_interval } => Ok(AuthPollResult {
            done: false,
            new_interval,
        }),
    }
}

#[tauri::command]
pub async fn auth_logout() -> Result<()> {
    auth::clear_token()
}

#[tauri::command]
pub async fn list_repos(state: State<'_, AppState>) -> Result<Vec<Repo>> {
    let token = require_token().await?;
    github::list_user_repos(&state.http, &token).await
}

#[tauri::command]
pub async fn list_repo_labels(
    state: State<'_, AppState>,
    repo: String,
) -> Result<Vec<RepoLabel>> {
    let token = require_token().await?;
    github::list_repo_labels(&state.http, &token, &repo).await
}

#[tauri::command]
pub async fn list_sources(app: AppHandle) -> Result<Vec<Source>> {
    let s = sources::list_sources(&app)?;
    log::debug!(
        "list_sources: {} entries ({} project, {} repo)",
        s.len(),
        s.iter()
            .filter(|x| matches!(x.kind, sources::SourceKind::Project { .. }))
            .count(),
        s.iter()
            .filter(|x| matches!(x.kind, sources::SourceKind::Repo { .. }))
            .count(),
    );
    Ok(s)
}

#[tauri::command]
pub async fn save_source(app: AppHandle, mut source: Source) -> Result<Source> {
    if source.id.is_empty() {
        source.id = Uuid::new_v4().to_string();
    }
    log::info!(
        "save_source: id={} name={} enabled={} kind={}",
        source.id,
        source.name,
        source.enabled,
        match &source.kind {
            sources::SourceKind::Repo { repo, query } => {
                format!("repo({repo} query={query:?})")
            }
            sources::SourceKind::Project {
                project_id, number, ..
            } => format!("project(#{number} id={project_id})"),
        }
    );
    sources::upsert_source(&app, source)
}

#[tauri::command]
pub async fn delete_source(app: AppHandle, id: String) -> Result<()> {
    sources::delete_source(&app, &id)
}

#[derive(Debug, Serialize)]
pub struct SourceResult {
    pub source_id: String,
    pub issues: Vec<Issue>,
    pub error: Option<String>,
}

/// Run every enabled source and return deduped issues with per-source metadata.
#[tauri::command]
pub async fn fetch_all(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<SourceResult>> {
    let token = require_token().await?;
    let sources = sources::list_sources(&app)?;
    let enabled_count = sources.iter().filter(|s| s.enabled).count();
    log::info!(
        "fetch_all: invoked; total_sources={} enabled_sources={}",
        sources.len(),
        enabled_count
    );
    let mut results: Vec<SourceResult> = Vec::new();

    for src in sources.iter().filter(|s| s.enabled) {
        let (repo, q) = match &src.kind {
            sources::SourceKind::Repo { repo, .. } => {
                (repo.clone(), src.full_query().unwrap_or_default())
            }
            sources::SourceKind::Project { .. } => continue,
        };
        log::debug!("fetch_all: source={} query={q}", src.name);
        match github::search_issues(&state.http, &token, &q).await {
            Ok(issues) => {
                log::debug!(
                    "fetch_all: source={} returned {} issue(s)",
                    src.name,
                    issues.len()
                );
                // Notify on any new issues not yet seen.
                if src.notify {
                    let seen = sources::load_seen(&app, &src.id).unwrap_or_default();
                    let current_ids: Vec<String> =
                        issues.iter().map(|i| i.node_id.clone()).collect();
                    let new_ids: Vec<&Issue> = issues
                        .iter()
                        .filter(|i| !seen.contains(&i.node_id))
                        .collect();

                    // Only notify after the first fetch (when `seen` is non-empty),
                    // so installing a Source doesn't flood the user.
                    if !seen.is_empty() && !new_ids.is_empty() {
                        for issue in new_ids.iter().take(5) {
                            let _ = notify::send(
                                &app,
                                &format!("{}: {}", src.name, issue.title),
                                &format!("#{} in {}", issue.number, repo),
                            );
                        }
                    }
                    let _ = sources::save_seen(&app, &src.id, &current_ids);
                }

                results.push(SourceResult {
                    source_id: src.id.clone(),
                    issues,
                    error: None,
                });
            }
            Err(e) => {
                log::error!("fetch_all: source={} error={e}", src.name);
                results.push(SourceResult {
                    source_id: src.id.clone(),
                    issues: vec![],
                    error: Some(e.to_string()),
                });
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn create_issue(
    state: State<'_, AppState>,
    repo: String,
    input: NewIssueInput,
) -> Result<Issue> {
    let token = require_token().await?;
    github::create_issue(&state.http, &token, &repo, &input).await
}

#[tauri::command]
pub async fn toggle_issue_state(
    state: State<'_, AppState>,
    repo: String,
    number: u64,
    closed: bool,
) -> Result<Issue> {
    let token = require_token().await?;
    let target = if closed { "closed" } else { "open" };
    github::set_issue_state(&state.http, &token, &repo, number, target).await
}

#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Settings> {
    sources::load_settings(&app)
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> Result<()> {
    sources::save_settings(&app, &settings)?;
    // Apply any visual settings that need an immediate side effect.
    #[cfg(desktop)]
    {
        if let Some(win) = app.get_webview_window("main") {
            crate::tray::apply_saved_size(&app, &win);
        }
        // Launch-at-login: sync the autostart plugin with the saved flag.
        apply_autostart(&app, settings.launch_at_login);
    }
    Ok(())
}

/// Enable or disable autostart to match the saved setting.
#[cfg(desktop)]
fn apply_autostart(app: &AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    let currently = mgr.is_enabled().unwrap_or(false);
    if enabled && !currently {
        if let Err(e) = mgr.enable() {
            log::warn!("autostart enable failed: {e}");
        }
    } else if !enabled && currently {
        if let Err(e) = mgr.disable() {
            log::warn!("autostart disable failed: {e}");
        }
    }
}

#[tauri::command]
pub async fn autostart_status(app: AppHandle) -> Result<bool> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        Ok(app.autolaunch().is_enabled().unwrap_or(false))
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(false)
    }
}

#[tauri::command]
pub async fn show_window(app: AppHandle) -> Result<()> {
    #[cfg(desktop)]
    crate::tray::show_at_tray(&app);
    #[cfg(not(desktop))]
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_window(app: AppHandle) -> Result<()> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) -> Result<()> {
    app.exit(0);
    Ok(())
}

/// Open the WebView's developer tools so users can inspect network calls,
/// check console logs, or diagnose sync issues without hunting for the
/// right-click menu. The underlying Tauri method is gated on the
/// `devtools` cargo feature, which our Cargo.toml enables for both dev
/// and release builds.
#[tauri::command]
pub async fn open_devtools(app: AppHandle) -> Result<()> {
    if let Some(win) = app.get_webview_window("main") {
        win.open_devtools();
    }
    Ok(())
}

#[tauri::command]
pub async fn set_auto_hide(
    enabled: bool,
    flag: State<'_, crate::AutoHideOnBlur>,
) -> Result<()> {
    flag.store(enabled, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}

// ------------------------- Projects v2 -------------------------------

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>> {
    let token = require_token().await?;
    projects::list_projects(&state.http, &token).await
}

#[derive(Debug, Serialize)]
pub struct ProjectFetchResult {
    pub source_id: String,
    pub snapshot: Option<ProjectSnapshot>,
    pub error: Option<String>,
}

/// Fetch all enabled Project sources. Each returns a full snapshot
/// (project metadata + fields + items) or an error. Project fetches run
/// concurrently; within one project, fields + items are also concurrent.
#[tauri::command]
pub async fn fetch_all_projects(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<ProjectFetchResult>> {
    let overall_start = std::time::Instant::now();
    let token = require_token().await?;
    let all_sources = sources::list_sources(&app)?;
    let project_sources: Vec<Source> = all_sources
        .into_iter()
        .filter(|s| s.enabled && matches!(s.kind, sources::SourceKind::Project { .. }))
        .collect();
    log::info!(
        "fetch_all_projects: invoked; project_sources={}",
        project_sources.len()
    );

    // Spawn concurrent fetches. Ordered results using a Vec<JoinHandle>.
    let mut handles = Vec::with_capacity(project_sources.len());
    for src in project_sources {
        let (project_id, items_query) = match &src.kind {
            sources::SourceKind::Project {
                project_id,
                items_query,
                ..
            } => (project_id.clone(), items_query.clone()),
            _ => continue,
        };
        let http = state.http.clone();
        let token = token.clone();
        let src_id = src.id.clone();
        let src_name = src.name.clone();
        handles.push(tokio::spawn(async move {
            let t0 = std::time::Instant::now();
            log::debug!(
                "fetch_all_projects: starting source={} project_id={} filter={:?}",
                src_name,
                project_id,
                items_query
            );
            let res = projects::fetch_project_snapshot(
                &http, &token, &project_id, &items_query,
            )
            .await;
            let ms = t0.elapsed().as_millis();
            match &res {
                Ok(snap) => log::info!(
                    "fetch_all_projects: source={} items={} fields={} took={}ms",
                    src_name,
                    snap.items.len(),
                    snap.fields.len(),
                    ms
                ),
                Err(e) => log::error!(
                    "fetch_all_projects: source={} error={e} took={}ms",
                    src_name,
                    ms
                ),
            }
            (src_id, res)
        }));
    }

    let mut out: Vec<ProjectFetchResult> = Vec::with_capacity(handles.len());
    for h in handles {
        match h.await {
            Ok((source_id, Ok(snap))) => out.push(ProjectFetchResult {
                source_id,
                snapshot: Some(snap),
                error: None,
            }),
            Ok((source_id, Err(e))) => out.push(ProjectFetchResult {
                source_id,
                snapshot: None,
                error: Some(e.to_string()),
            }),
            Err(join_err) => {
                log::error!("fetch_all_projects: join error {join_err}");
            }
        }
    }
    log::info!(
        "fetch_all_projects: complete; total={}ms results={}",
        overall_start.elapsed().as_millis(),
        out.len()
    );
    Ok(out)
}

/// Streaming variant of `fetch_all_projects`. Starts per-source fetches
/// concurrently and emits each parsed page as a `project-page` event. Returns
/// once every source has finished (or errored). Frontend should subscribe
/// to `project-page` before invoking, then merge incoming pages into its
/// store as they arrive.
#[tauri::command]
pub async fn fetch_all_projects_streaming(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    let overall_start = std::time::Instant::now();
    let token = require_token().await?;
    let all_sources = sources::list_sources(&app)?;
    let project_sources: Vec<Source> = all_sources
        .into_iter()
        .filter(|s| s.enabled && matches!(s.kind, sources::SourceKind::Project { .. }))
        .collect();
    log::info!(
        "fetch_all_projects_streaming: invoked; project_sources={}",
        project_sources.len()
    );

    let mut handles = Vec::with_capacity(project_sources.len());
    for src in project_sources {
        let (project_id, items_query) = match &src.kind {
            sources::SourceKind::Project {
                project_id,
                items_query,
                ..
            } => (project_id.clone(), items_query.clone()),
            _ => continue,
        };
        let http = state.http.clone();
        let token = token.clone();
        let app2 = app.clone();
        let src_id = src.id.clone();
        let src_name = src.name.clone();
        // Load prior-run cursors so we can speculatively fan out pages in
        // parallel. First run (empty) falls back to serial paging.
        let prior_cursors =
            sources::load_cursors(&app, &src_id).unwrap_or_default();
        let app_for_save = app.clone();
        handles.push(tokio::spawn(async move {
            let t0 = std::time::Instant::now();
            let mut page_count = 0usize;
            let mut item_count = 0usize;
            let fresh_cursors = projects::stream_project_snapshot(
                &http,
                &token,
                &src_id,
                &project_id,
                &items_query,
                &prior_cursors,
                |evt| {
                    page_count += 1;
                    item_count += evt.items.len();
                    if let Err(e) = app2.emit("project-page", &evt) {
                        log::warn!("emit project-page failed: {e}");
                    }
                },
            )
            .await;
            log::info!(
                "fetch_all_projects_streaming: source={} pages={} items={} took={}ms (prior_cursors={} fresh_cursors={})",
                src_name,
                page_count,
                item_count,
                t0.elapsed().as_millis(),
                prior_cursors.len(),
                fresh_cursors.len(),
            );
            // Persist cursors for the next sync's speculative fan-out.
            if !fresh_cursors.is_empty() {
                if let Err(e) =
                    sources::save_cursors(&app_for_save, &src_id, &fresh_cursors)
                {
                    log::warn!("failed to save cursors for source={src_id}: {e}");
                }
            }
        }));
    }

    for h in handles {
        let _ = h.await;
    }
    log::info!(
        "fetch_all_projects_streaming: complete; total={}ms",
        overall_start.elapsed().as_millis()
    );
    Ok(())
}

#[tauri::command]
pub async fn set_project_item_status(
    state: State<'_, AppState>,
    project_id: String,
    item_id: String,
    field_id: String,
    option_id: Option<String>,
) -> Result<()> {
    let token = require_token().await?;
    projects::set_single_select_field(
        &state.http,
        &token,
        &project_id,
        &item_id,
        &field_id,
        option_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn add_issue_comment(
    state: State<'_, AppState>,
    repo: String,
    number: u64,
    body: String,
) -> Result<()> {
    let token = require_token().await?;
    projects::add_issue_comment(&state.http, &token, &repo, number, &body).await
}

/// Create an issue and attach it to a ProjectV2 in one shot. Returns the
#[derive(Debug, Serialize)]
pub struct CreateIssueInProjectResult {
    pub issue: Issue,
    pub item_id: String,
}

/// Create an issue, attach it to a project, and optionally set one
/// single-select field (typically Status) in one round-trip from the
/// frontend. Returns the Issue plus the ProjectV2Item id so the caller
/// can reference the attached item for further mutations / optimistic UI.
#[tauri::command]
pub async fn create_issue_in_project(
    state: State<'_, AppState>,
    repo: String,
    project_id: String,
    input: NewIssueInput,
    status_field_id: Option<String>,
    status_option_id: Option<String>,
) -> Result<CreateIssueInProjectResult> {
    let token = require_token().await?;
    let issue = github::create_issue(&state.http, &token, &repo, &input).await?;
    let item_id =
        projects::add_item_to_project(&state.http, &token, &project_id, &issue.node_id).await?;

    if let (Some(field_id), Some(option_id)) = (status_field_id, status_option_id.clone()) {
        // Best-effort: if the status mutation fails, the item still exists on
        // the board — just without a status. Log and return success.
        if let Err(e) = projects::set_single_select_field(
            &state.http,
            &token,
            &project_id,
            &item_id,
            &field_id,
            Some(&option_id),
        )
        .await
        {
            log::warn!("create_issue_in_project: initial status set failed: {e}");
        }
    }

    Ok(CreateIssueInProjectResult { issue, item_id })
}

// ------------------------- Issue templates ---------------------------

#[tauri::command]
pub async fn list_issue_templates(
    state: State<'_, AppState>,
    repo: String,
) -> Result<crate::templates::IssueTemplateSet> {
    let token = require_token().await?;
    crate::templates::list_issue_templates(&state.http, &token, &repo).await
}

// ------------------------- Issue detail ------------------------------

#[derive(Debug, Serialize)]
pub struct IssueDetail {
    pub issue: Issue,
    pub comments: Vec<IssueComment>,
}

// ------------------------- Auto-update -------------------------------

#[derive(Debug, Serialize)]
pub struct UpdateCheckResult {
    pub available: bool,
    pub version: Option<String>,
    pub body: Option<String>,
}

/// Query the configured update endpoint. Returns whether a newer
/// version exists and its release-notes body.
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<UpdateCheckResult> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|e| crate::error::Error::Other(format!("updater init: {e}")))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateCheckResult {
            available: true,
            version: Some(update.version.clone()),
            body: update.body.clone(),
        }),
        Ok(None) => Ok(UpdateCheckResult {
            available: false,
            version: None,
            body: None,
        }),
        Err(e) => Err(crate::error::Error::Other(format!("check: {e}"))),
    }
}

/// Download + install the available update and relaunch. Blocks until
/// install completes; on macOS the app replaces its bundle in place
/// then respawns.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<()> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|e| crate::error::Error::Other(format!("updater init: {e}")))?;
    let update = updater
        .check()
        .await
        .map_err(|e| crate::error::Error::Other(format!("check: {e}")))?
        .ok_or_else(|| crate::error::Error::Other("no update available".into()))?;
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| crate::error::Error::Other(format!("install: {e}")))?;
    // Relaunch into the new bundle.
    app.restart();
}

/// Fetch the full issue + every comment in one round-trip from the
/// frontend. Body and comments run in parallel.
#[tauri::command]
pub async fn get_issue_detail(
    state: State<'_, AppState>,
    repo: String,
    number: u64,
) -> Result<IssueDetail> {
    let token = require_token().await?;
    let (issue, comments) = tokio::try_join!(
        github::get_issue(&state.http, &token, &repo, number),
        github::list_issue_comments(&state.http, &token, &repo, number),
    )?;
    Ok(IssueDetail { issue, comments })
}
