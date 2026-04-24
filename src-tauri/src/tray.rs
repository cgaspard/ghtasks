use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Manager, PhysicalPosition, PhysicalSize, Rect,
};

/// Tray icon (GitHub mark) baked into the binary at compile time, so the
/// tray always uses our icon instead of falling back to the app icon.
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray.png");

/// Alternate tray icon shown when a newer release is available. Same
/// octocat silhouette with a small down-arrow notched into the
/// top-right corner — reads as "GitHub / pending download." Black on
/// transparent, rendered as a template image so macOS tints it to
/// match the menu bar.
const TRAY_UPDATE_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-update.png");

pub fn setup(app: &App) -> tauri::Result<()> {
    let handle = app.handle();

    let show_item = MenuItem::with_id(handle, "show", "Show", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(handle, "hide", "Hide", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(handle, "quit", "Quit GH Tasks", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(handle)?;

    let menu = Menu::with_items(
        handle,
        &[&show_item, &hide_item, &separator, &quit_item],
    )?;

    let tray_icon = Image::from_bytes(TRAY_ICON_BYTES)
        .expect("embedded tray.png must decode");

    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("GH Tasks")
        .icon(tray_icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_at_tray(app),
            "hide" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_window(app, rect);
            }
        })
        .build(handle)?;

    Ok(())
}

fn toggle_window(app: &tauri::AppHandle, tray_rect: Rect) {
    if let Some(win) = app.get_webview_window("main") {
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => {
                position_under_tray(&win, tray_rect);
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    }
}

/// Show the window, positioned at the tray icon if we can find it.
pub fn show_at_tray(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    apply_saved_size(app, &win);
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(Some(rect)) = tray.rect() {
            position_under_tray(&win, rect);
        }
    }
    let _ = win.show();
    let _ = win.set_focus();
}

/// Read the user's saved window-size preset from the store and resize the
/// window to match. Silently no-ops if reading fails.
pub fn apply_saved_size(
    app: &tauri::AppHandle,
    win: &tauri::WebviewWindow,
) {
    let preset = match crate::sources::load_settings(app) {
        Ok(s) => s.window_size,
        Err(_) => "default".to_string(),
    };
    let (w, h) = crate::sources::window_dims(&preset);
    let _ = win.set_size(tauri::LogicalSize::new(w, h));
}

/// Position the window so it hangs just below the tray icon, horizontally
/// centered on it. Falls back silently if any platform lookup fails.
fn position_under_tray(win: &tauri::WebviewWindow, tray_rect: Rect) {
    let win_size: PhysicalSize<u32> = match win.outer_size() {
        Ok(s) => s,
        Err(_) => return,
    };

    // `Rect` position/size are logical-or-physical (tagged). Convert with the
    // window's current scale factor — good enough on the primary display;
    // for multi-monitor we look up the target monitor's scale below.
    let win_scale = win.scale_factor().unwrap_or(1.0);
    let tray_pos = tray_rect.position.to_physical::<f64>(win_scale);
    let tray_size = tray_rect.size.to_physical::<f64>(win_scale);

    let tray_center_x = tray_pos.x + tray_size.width / 2.0;
    let tray_bottom_y = tray_pos.y + tray_size.height;

    // Find the monitor that contains the tray's center point. Fall back to
    // the window's current monitor, then to no clamp.
    let target_monitor = win
        .available_monitors()
        .ok()
        .and_then(|mons| {
            mons.into_iter().find(|m| {
                let p = m.position();
                let s = m.size();
                let x = p.x as f64;
                let y = p.y as f64;
                tray_center_x >= x
                    && tray_center_x < x + s.width as f64
                    && tray_bottom_y - 1.0 >= y
                    && tray_bottom_y - 1.0 < y + s.height as f64
            })
        })
        .or_else(|| win.current_monitor().ok().flatten());

    let margin = 8.0;
    let (final_x, final_y) = if let Some(monitor) = target_monitor {
        let m_pos = monitor.position();
        let m_size = monitor.size();
        let m_left = m_pos.x as f64;
        let m_top = m_pos.y as f64;
        let m_right = m_left + m_size.width as f64;
        let m_bottom = m_top + m_size.height as f64;

        let target_x = tray_center_x - win_size.width as f64 / 2.0;
        let min_x = m_left + margin;
        let max_x = m_right - win_size.width as f64 - margin;
        let clamped_x = target_x.clamp(min_x, max_x.max(min_x));

        let gap = 6.0;
        let target_y = tray_bottom_y + gap;
        let max_y = m_bottom - win_size.height as f64 - margin;
        let clamped_y = target_y.min(max_y).max(m_top + margin);

        (clamped_x, clamped_y)
    } else {
        let target_x = tray_center_x - win_size.width as f64 / 2.0;
        let target_y = tray_bottom_y + 6.0;
        (target_x, target_y)
    };

    log::debug!(
        "position_under_tray: tray=({:.0},{:.0} {:.0}x{:.0}) win={}x{} final=({:.0},{:.0})",
        tray_pos.x,
        tray_pos.y,
        tray_size.width,
        tray_size.height,
        win_size.width,
        win_size.height,
        final_x,
        final_y
    );

    let _ = win.set_position(PhysicalPosition::new(
        final_x.round() as i32,
        final_y.round() as i32,
    ));
}

/// Swap the tray icon + tooltip in response to an update-availability
/// change. Called by the frontend when the `$updateAvailable` store
/// changes. Keeps template-mode on so macOS keeps tinting the icon
/// correctly for light/dark menu bars.
pub fn set_update_state(
    app: &tauri::AppHandle,
    available: bool,
    version: Option<&str>,
) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };

    let (bytes, tooltip) = if available {
        let tip = match version {
            Some(v) if !v.is_empty() => format!("GH Tasks — update to v{v} available"),
            _ => "GH Tasks — update available".to_string(),
        };
        (TRAY_UPDATE_ICON_BYTES, tip)
    } else {
        (TRAY_ICON_BYTES, "GH Tasks".to_string())
    };

    match Image::from_bytes(bytes) {
        Ok(img) => {
            let _ = tray.set_icon(Some(img));
            let _ = tray.set_icon_as_template(true);
        }
        Err(e) => log::warn!("tray::set_update_state icon decode failed: {e}"),
    }
    let _ = tray.set_tooltip(Some(&tooltip));
}
