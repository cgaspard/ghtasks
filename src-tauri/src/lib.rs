mod auth;
mod commands;
mod error;
mod github;
mod http_log;
mod migration;
mod notify;
mod projects;
mod sources;
mod templates;
mod tray;

use commands::AppState;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::Manager;

/// Whether the window should auto-hide when focus is lost. Toggled from the
/// frontend during the OAuth device flow so the browser hand-off doesn't
/// close the popover mid-authentication.
pub type AutoHideOnBlur = Arc<AtomicBool>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Default to info for everything and debug for our own crate, unless
    // RUST_LOG is set explicitly.
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info,ghtasks_lib=debug"),
    )
    .init();

    log::info!(
        "ghtasks starting; client_id_source={}",
        if std::env::var("GHTASKS_CLIENT_ID").is_ok() {
            "runtime-env"
        } else if option_env!("GHTASKS_CLIENT_ID").is_some() {
            "build-env"
        } else {
            "placeholder (will fail)"
        }
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            http: github::http_client(),
        })
        .manage::<AutoHideOnBlur>(Arc::new(AtomicBool::new(true)))
        .setup(|app| {
            // One-shot data migration from the legacy `dev.ghtasks.app`
            // identifier to `com.cgaspard.ghtasks`. Runs before anything
            // else reads the store so saved sources/settings carry over.
            migration::migrate_store_from_legacy(app);

            // Build the tray. On desktop only — mobile has no tray.
            #[cfg(desktop)]
            tray::setup(app)?;

            // Hide from the macOS Dock; the app lives in the menu bar.
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            // Hide on blur so the popover behaves like a menu-bar panel.
            // Disabled during the OAuth device flow — the browser steals focus
            // and would hide the window before the user can see the user code.
            // Toggled via the `auto_hide_on_blur` Mutex below.
            // Sync autostart to the saved setting (no-op if already matching).
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::ManagerExt;
                if let Ok(s) = sources::load_settings(&app.handle()) {
                    let mgr = app.autolaunch();
                    let currently = mgr.is_enabled().unwrap_or(false);
                    if s.launch_at_login && !currently {
                        let _ = mgr.enable();
                    } else if !s.launch_at_login && currently {
                        let _ = mgr.disable();
                    }
                }
            }

            if let Some(win) = app.get_webview_window("main") {
                // Apply the user's preferred size preset before the first show.
                #[cfg(desktop)]
                tray::apply_saved_size(&app.handle(), &win);

                // The white flash on tray-click show is killed by wry
                // setting `drawsBackground = false` on the WKWebView
                // config whenever the `transparent` feature is on (which
                // we enable via `macOSPrivateApi: true` in
                // tauri.conf.json). That's independent of whether we
                // set a background color here — so we deliberately
                // DON'T set one. Setting an opaque color paints over
                // the corner pixels where `#app`'s border-radius
                // leaves gaps, defeating the CSS rounded-corner
                // effect. Leaving `underPageBackgroundColor` unset
                // keeps those corners transparent so the desktop
                // shows through.

                let win_clone = win.clone();
                let auto_hide = app.state::<AutoHideOnBlur>().inner().clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        if auto_hide.load(std::sync::atomic::Ordering::Relaxed) {
                            let _ = win_clone.hide();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::auth_status,
            commands::auth_start,
            commands::auth_poll,
            commands::auth_logout,
            commands::list_repos,
            commands::list_repo_labels,
            commands::list_sources,
            commands::save_source,
            commands::delete_source,
            commands::fetch_all,
            commands::create_issue,
            commands::toggle_issue_state,
            commands::get_settings,
            commands::save_settings,
            commands::show_window,
            commands::hide_window,
            commands::quit_app,
            commands::open_devtools,
            commands::set_auto_hide,
            commands::list_projects,
            commands::fetch_all_projects,
            commands::fetch_all_projects_streaming,
            commands::set_project_item_status,
            commands::add_issue_comment,
            commands::create_issue_in_project,
            commands::autostart_status,
            commands::list_issue_templates,
            commands::get_issue_detail,
            commands::check_for_updates,
            commands::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
