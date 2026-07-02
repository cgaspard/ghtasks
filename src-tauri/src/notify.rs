//! Desktop notifications via the native macOS `UserNotifications` framework
//! (through the `user-notify` crate), which — unlike `tauri-plugin-notification`
//! — lets us react to CLICKS. A clicked notification focuses the app and jumps
//! to the Inbox tab (see `lib.rs` where the click handler is registered).
//!
//! IMPORTANT (macOS): real notifications only fire from a **signed, bundled**
//! `.app`. In an unbundled `npm run tauri dev` binary the crate returns an
//! in-memory mock that logs but shows nothing — so clickable notifications must
//! be verified from a `tauri build` / release build.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use tauri::{AppHandle, Emitter};
use user_notify::{get_notification_manager, NotificationBuilder, NotificationManager};

/// The single process-wide notification manager. Kept alive for the whole
/// process (its internal delegate panics if dropped), created + registered once
/// on the main thread from `lib.rs`.
static MANAGER: OnceLock<Arc<dyn NotificationManager>> = OnceLock::new();

/// Event key emitted to the frontend when a notification is clicked.
pub const OPEN_INBOX_EVENT: &str = "open-inbox-item";
/// user_info key carrying the clicked item's node_id.
const USER_INFO_NODE_ID: &str = "node_id";

/// Initialize the notification manager and register the click handler. Call
/// ONCE, on the MAIN THREAD, during Tauri `setup`. On a clicked notification we
/// focus the window and emit `OPEN_INBOX_EVENT` with the item's node_id.
pub fn init(app: &AppHandle, bundle_id: &str) {
    let manager = get_notification_manager(bundle_id.to_string(), None);

    let app_for_click = app.clone();
    let register_result = manager.register(
        Box::new(move |response| {
            use user_notify::NotificationResponseAction::Default as DefaultAction;
            if response.action != DefaultAction {
                return; // ignore dismiss / action buttons
            }
            // Focus + position the window under the tray, then navigate.
            crate::tray::show_at_tray(&app_for_click);
            let node_id = response
                .user_info
                .get(USER_INFO_NODE_ID)
                .cloned()
                .unwrap_or_default();
            let _ = app_for_click.emit(OPEN_INBOX_EVENT, node_id);
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

/// Show a desktop notification. `node_id` (when non-empty) is attached so a
/// click can route the frontend to that Inbox item. Best-effort: if the manager
/// isn't initialized (or we're the dev mock), this is a no-op / logs only.
pub fn send(_app: &AppHandle, title: &str, body: &str, node_id: &str) {
    let Some(manager) = MANAGER.get().cloned() else {
        log::debug!("notify: manager not initialized; skipping '{title}'");
        return;
    };

    // `.sound(true)` attaches UNNotificationSound.default — macOS gates it by
    // the per-app notification-sound setting, Focus, and Do Not Disturb.
    let mut builder = NotificationBuilder::new().title(title).body(body).sound(true);
    if !node_id.is_empty() {
        let mut info = HashMap::new();
        info.insert(USER_INFO_NODE_ID.to_string(), node_id.to_string());
        builder = builder.set_user_info(info);
    }

    tauri::async_runtime::spawn(async move {
        if let Err(e) = manager.send_notification(builder).await {
            log::warn!("notify: send failed: {e}");
        }
    });
}
