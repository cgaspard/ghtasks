use crate::error::Result;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn send(app: &AppHandle, title: &str, body: &str) -> Result<()> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| crate::error::Error::Other(e.to_string()))?;
    Ok(())
}
