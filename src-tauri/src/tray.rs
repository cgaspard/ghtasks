use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Manager, Runtime,
};

pub fn setup<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let handle = app.handle();

    let show_item = MenuItem::with_id(handle, "show", "Show", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(handle, "hide", "Hide", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(handle, "quit", "Quit GH Tasks", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(handle)?;

    let menu = Menu::with_items(
        handle,
        &[&show_item, &hide_item, &separator, &quit_item],
    )?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("GH Tasks")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
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
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_window(app);
            }
        })
        .build(handle)?;

    Ok(())
}

fn toggle_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        match win.is_visible() {
            Ok(true) => {
                let _ = win.hide();
            }
            _ => {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    }
}
