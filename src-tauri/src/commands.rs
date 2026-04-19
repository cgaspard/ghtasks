use crate::auth;
use crate::error::{Error, Result};
use crate::github::{self, Issue, NewIssueInput, Repo, User};
use crate::notify;
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

#[tauri::command]
pub async fn auth_poll(
    state: State<'_, AppState>,
    device_code: String,
) -> Result<bool> {
    match auth::poll_for_token(&state.http, &device_code).await {
        Ok(Some(token)) => {
            auth::store_token(&token)?;
            Ok(true)
        }
        Ok(None) => Ok(false),
        Err(Error::AuthPending) | Err(Error::AuthSlowDown) => Ok(false),
        Err(e) => Err(e),
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
pub async fn list_sources(app: AppHandle) -> Result<Vec<Source>> {
    sources::list_sources(&app)
}

#[tauri::command]
pub async fn save_source(app: AppHandle, mut source: Source) -> Result<Source> {
    if source.id.is_empty() {
        source.id = Uuid::new_v4().to_string();
    }
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
    let mut results: Vec<SourceResult> = Vec::new();

    for src in sources.iter().filter(|s| s.enabled) {
        let q = src.full_query();
        match github::search_issues(&state.http, &token, &q).await {
            Ok(issues) => {
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
                                &format!("#{} in {}", issue.number, src.repo),
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
            Err(e) => results.push(SourceResult {
                source_id: src.id.clone(),
                issues: vec![],
                error: Some(e.to_string()),
            }),
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
    sources::save_settings(&app, &settings)
}

#[tauri::command]
pub async fn show_window(app: AppHandle) -> Result<()> {
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
