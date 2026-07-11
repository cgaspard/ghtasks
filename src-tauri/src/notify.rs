//! Desktop notifications via the native macOS `UserNotifications` framework
//! (through the `user-notify` crate), which — unlike `tauri-plugin-notification`
//! — lets us react to CLICKS. A clicked notification opens the underlying
//! issue/PR on github.com in the user's browser (see the click handler below).
//!
//! IMPORTANT (macOS): real notifications only fire from a **signed, bundled**
//! `.app`. In an unbundled `npm run tauri dev` binary the crate returns an
//! in-memory mock that logs but shows nothing — so clickable notifications must
//! be verified from a `tauri build` / release build.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use user_notify::{get_notification_manager, NotificationBuilder, NotificationManager};

/// The single process-wide notification manager. Kept alive for the whole
/// process (its internal delegate panics if dropped), created + registered once
/// on the main thread from `lib.rs`.
static MANAGER: OnceLock<Arc<dyn NotificationManager>> = OnceLock::new();

/// user_info key carrying the clicked item's github.com URL.
const USER_INFO_URL: &str = "url";

/// Initialize the notification manager and register the click handler. Call
/// ONCE, on the MAIN THREAD, during Tauri `setup`. A clicked notification opens
/// the item's github.com URL in the browser — it deliberately does NOT show or
/// focus the app window, so the menu-bar app stays out of the way (and out of
/// the Dock: focusing the window from a notification-triggered OS activation
/// was promoting the app from Accessory to a Dock-visible foreground app).
pub fn init(app: &AppHandle, bundle_id: &str) {
    let manager = get_notification_manager(bundle_id.to_string(), None);

    let app_for_click = app.clone();
    let register_result = manager.register(
        Box::new(move |response| {
            use user_notify::NotificationResponseAction::Default as DefaultAction;
            if response.action != DefaultAction {
                return; // ignore dismiss / action buttons
            }
            let Some(url) = response.user_info.get(USER_INFO_URL) else {
                return; // no URL attached — nothing to open
            };
            if let Err(e) = app_for_click.opener().open_url(url, None::<&str>) {
                log::warn!("notify: failed to open {url}: {e}");
            }
            // Clicking a notification makes macOS activate the app, which pops a
            // Dock icon. Re-assert the menu-bar-only policy — but this handler
            // runs on `user-notify`'s own worker thread, and AppKit's
            // `setActivationPolicy` only takes effect on the MAIN thread, so
            // marshal it there. (The `RunEvent::Reopen` handler in lib.rs is a
            // second line of defense for activations that don't route here.)
            #[cfg(target_os = "macos")]
            {
                let app = app_for_click.clone();
                let _ = app_for_click.run_on_main_thread(move || {
                    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                });
            }
        }),
        vec![], // no action buttons — plain clickable notifications
    );
    if let Err(e) = register_result {
        log::warn!("notify: register failed (notifications may be unavailable): {e}");
        return;
    }

    if MANAGER.set(manager.clone()).is_err() {
        log::warn!("notify: init called more than once");
        return;
    }

    // Ask for permission once (async; main-thread-safe). Fire-and-forget.
    tauri::async_runtime::spawn(async move {
        if let Err(e) = manager.first_time_ask_for_notification_permission().await {
            log::warn!("notify: permission request failed: {e}");
        }
    });
}

/// Whether the OS currently allows this app to show notifications. `None`
/// when the manager isn't initialized yet (dev mock, or `init()` hasn't run) —
/// the frontend treats that the same as "unknown," not "denied." macOS never
/// re-prompts once a user denies permission, so this is how the UI detects a
/// stuck-denied state and can point the user at System Settings instead of
/// silently doing nothing.
pub async fn permission_granted() -> Option<bool> {
    let manager = MANAGER.get().cloned()?;
    manager.get_notification_permission_state().await.ok()
}

/// Derive a stable notification thread id from a github.com URL, so all
/// notifications for the same repo collapse into one expandable stack in
/// Notification Center instead of piling up as separate items. Falls back to a
/// single app-wide thread when no repo can be parsed.
fn thread_for(url: &str) -> String {
    // https://github.com/{owner}/{name}/... -> "{owner}/{name}"
    url.strip_prefix("https://github.com/")
        .and_then(|rest| {
            let mut parts = rest.split('/');
            let owner = parts.next()?;
            let name = parts.next()?;
            if owner.is_empty() || name.is_empty() {
                return None;
            }
            Some(format!("{owner}/{name}"))
        })
        .unwrap_or_else(|| "ghtasks".to_string())
}

/// Show a desktop notification. `url` (when non-empty) is attached so a click
/// opens it in the browser. Notifications are grouped by repo thread so they
/// collapse into one stack rather than piling up. Best-effort: if the manager
/// isn't initialized (or we're the dev mock), this is a no-op / logs only.
pub fn send(_app: &AppHandle, title: &str, body: &str, url: &str) {
    let Some(manager) = MANAGER.get().cloned() else {
        log::debug!("notify: manager not initialized; skipping '{title}'");
        return;
    };

    // `.sound(true)` attaches UNNotificationSound.default — macOS gates it by
    // the per-app notification-sound setting, Focus, and Do Not Disturb.
    let mut builder = NotificationBuilder::new()
        .title(title)
        .body(body)
        .sound(true)
        .set_thread_id(&thread_for(url));
    if !url.is_empty() {
        let mut info = HashMap::new();
        info.insert(USER_INFO_URL.to_string(), url.to_string());
        builder = builder.set_user_info(info);
    }

    tauri::async_runtime::spawn(async move {
        if let Err(e) = manager.send_notification(builder).await {
            log::warn!("notify: send failed: {e}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::thread_for;

    #[test]
    fn thread_id_groups_by_repo() {
        assert_eq!(
            thread_for("https://github.com/safeevac/monorepo/issues/1228"),
            "safeevac/monorepo"
        );
        assert_eq!(
            thread_for("https://github.com/safeevac/monorepo/pull/1533"),
            "safeevac/monorepo"
        );
        // repo root (non-addressable items link here)
        assert_eq!(
            thread_for("https://github.com/safeevac/monorepo"),
            "safeevac/monorepo"
        );
        // unparseable -> single app-wide thread
        assert_eq!(thread_for(""), "ghtasks");
        assert_eq!(thread_for("https://github.com/"), "ghtasks");
    }
}
