//! One-shot data migration for the bundle-identifier rename
//! (`dev.ghtasks.app` → `com.cgaspard.ghtasks`).
//!
//! This runs very early in app setup, before the store plugin has opened
//! any files. If the new data directory already has our store file, we
//! treat that as the source of truth and skip (the user has already used
//! the renamed app). Otherwise we copy the legacy store over.
//!
//! Keychain token migration lives in `auth::load_token` because it runs
//! on-demand and it's tied to that flow's error handling.

use std::path::PathBuf;

const LEGACY_IDENTIFIER: &str = "dev.ghtasks.app";

/// Copy the plugin-store data directory from the legacy identifier to the
/// current one, if the current one doesn't already exist. Silently no-ops
/// on any error — migration is best-effort, the app still works without it.
pub fn migrate_store_from_legacy(app: &tauri::App) {
    let Some(current_dir) = app_data_dir_for(&app.config().identifier) else {
        return;
    };
    let Some(legacy_dir) = app_data_dir_for(LEGACY_IDENTIFIER) else {
        return;
    };
    if legacy_dir == current_dir {
        return;
    }
    if !legacy_dir.exists() {
        log::debug!(
            "migration: no legacy data directory at {}",
            legacy_dir.display()
        );
        return;
    }
    if current_dir.exists() && has_store_file(&current_dir) {
        log::debug!(
            "migration: new directory {} already populated; skipping",
            current_dir.display()
        );
        return;
    }

    log::info!(
        "migration: copying {} → {}",
        legacy_dir.display(),
        current_dir.display()
    );
    if let Err(e) = std::fs::create_dir_all(&current_dir) {
        log::warn!("migration: create_dir_all failed: {e}");
        return;
    }
    if let Err(e) = copy_dir_shallow(&legacy_dir, &current_dir) {
        log::warn!("migration: copy failed: {e}");
    }
}

fn has_store_file(dir: &std::path::Path) -> bool {
    std::fs::read_dir(dir)
        .map(|iter| {
            iter.flatten().any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .ends_with("ghtasks.json")
            })
        })
        .unwrap_or(false)
}

/// Resolve `$HOME/Library/Application Support/<identifier>` on macOS,
/// the equivalent on Linux ($XDG_DATA_HOME / ~/.local/share), and
/// `%APPDATA%\<identifier>` on Windows. We mirror what Tauri does
/// internally (via the `dirs` crate's `data_dir`).
fn app_data_dir_for(identifier: &str) -> Option<PathBuf> {
    let base = dirs_data_dir()?;
    Some(base.join(identifier))
}

fn dirs_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|h| h.join("Library").join("Application Support"))
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            Some(PathBuf::from(xdg))
        } else {
            std::env::var_os("HOME")
                .map(PathBuf::from)
                .map(|h| h.join(".local").join("share"))
        }
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(PathBuf::from)
    }
}

/// One-level deep copy. Tauri's store writes flat files under the data dir
/// so we don't need recursion. Skips entries that already exist at the
/// destination.
fn copy_dir_shallow(
    from: &std::path::Path,
    to: &std::path::Path,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        if !ft.is_file() {
            continue;
        }
        let dest = to.join(entry.file_name());
        if dest.exists() {
            continue;
        }
        std::fs::copy(entry.path(), &dest)?;
        log::debug!(
            "migration: copied {} -> {}",
            entry.path().display(),
            dest.display()
        );
    }
    Ok(())
}
