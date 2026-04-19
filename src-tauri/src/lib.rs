mod auth;
mod commands;
mod error;
mod github;
mod notify;
mod sources;
mod tray;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            http: github::http_client(),
        })
        .setup(|app| {
            // Build the tray. On desktop only — mobile has no tray.
            #[cfg(desktop)]
            tray::setup(app)?;

            // Hide from the macOS Dock; the app lives in the menu bar.
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            // Hide on blur so the popover behaves like a menu-bar panel.
            if let Some(win) = app.get_webview_window("main") {
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = win_clone.hide();
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
