use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Wry};
use tauri_plugin_store::{Store, StoreExt};

const STORE_PATH: &str = "ghtasks.json";
const KEY_SOURCES: &str = "sources";
const KEY_SETTINGS: &str = "settings";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SourceKind {
    /// A GitHub repo + issue-search query.
    Repo {
        /// `owner/name`
        repo: String,
        /// Raw search-issues query (without `repo:`; we prepend it).
        query: String,
    },
    /// A GitHub Projects v2 board.
    Project {
        /// GraphQL node id of the ProjectV2 (stable).
        project_id: String,
        /// `owner/login` — displayed in UI.
        owner_login: String,
        /// Project number (the integer in the URL).
        number: u32,
        /// Project title — cached for display; updated on fetch.
        #[serde(default)]
        title: String,
        /// Server-side filter passed to `ProjectV2.items(query:)`. Uses the
        /// same grammar as the GitHub web UI / REST `q=` (e.g. `is:open`,
        /// `-status:Released`, `assignee:@me`). Applied in GraphQL so we
        /// never fetch items we don't care about. Defaults to empty.
        #[serde(default = "default_project_query")]
        items_query: String,
    },
}

fn default_project_query() -> String {
    // Exclude Released items by default — most boards treat Released as a
    // permanent landing pad, so pulling hundreds of them on every refresh
    // is wasted work. Users can override per-source.
    "-status:Released".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Source {
    pub id: String,
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default = "default_notify")]
    pub notify: bool,
    #[serde(flatten)]
    pub kind: SourceKind,
}

fn default_enabled() -> bool {
    true
}
fn default_notify() -> bool {
    true
}

impl Source {
    /// Compose the full GitHub search query for a Repo source. Returns None
    /// for Project sources (which don't use the search API).
    pub fn full_query(&self) -> Option<String> {
        match &self.kind {
            SourceKind::Repo { repo, query } => {
                let trimmed = query.trim();
                if trimmed.is_empty() {
                    Some(format!("repo:{repo} is:issue is:open"))
                } else {
                    Some(format!("repo:{repo} {trimmed}"))
                }
            }
            SourceKind::Project { .. } => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    #[serde(default)]
    pub default_repo: Option<String>,
    #[serde(default = "default_poll_secs")]
    pub poll_interval_secs: u64,
    #[serde(default)]
    pub launch_at_login: bool,
    #[serde(default = "default_window_size")]
    pub window_size: String,
    /// Row density preset: "compact" | "default" | "comfortable" | "spacious".
    #[serde(default = "default_row_density")]
    pub row_density: String,
    /// When true, opening or clearing an Awaiting item also marks its GitHub
    /// notification thread read (syncing to the user's real inbox). Off by
    /// default so the app never mutates the inbox unexpectedly.
    #[serde(default)]
    pub notifications_sync: bool,
}

fn default_poll_secs() -> u64 {
    90
}
fn default_window_size() -> String {
    "large".to_string()
}
fn default_row_density() -> String {
    "default".to_string()
}

/// Resolve a size-preset name to (width, height) in logical pixels. Only "wide"
/// and "large" are supported now; legacy names (compact/default/tall) fall back
/// to "large", the nearest kept option.
pub fn window_dims(preset: &str) -> (u32, u32) {
    match preset {
        "wide" => (480, 560),
        _ => (480, 760), // "large" (and any legacy value)
    }
}

fn store_handle(app: &AppHandle) -> Result<Arc<Store<Wry>>> {
    app.store(STORE_PATH).map_err(Error::from)
}

pub fn list_sources(app: &AppHandle) -> Result<Vec<Source>> {
    let store = store_handle(app)?;
    let value = store.get(KEY_SOURCES).unwrap_or(serde_json::Value::Array(vec![]));
    let sources = parse_sources_migrating(value);
    Ok(sources)
}

/// Parse a stored `sources` blob, migrating any legacy records (flat
/// `repo`/`query` with no `kind`) into the tagged Repo form.
fn parse_sources_migrating(value: serde_json::Value) -> Vec<Source> {
    let Some(array) = value.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::with_capacity(array.len());
    for item in array {
        // Fast path: already a tagged source.
        if let Ok(s) = serde_json::from_value::<Source>(item.clone()) {
            out.push(s);
            continue;
        }
        // Legacy path: { id, name, repo, query, enabled?, color?, notify? }.
        if let Some(obj) = item.as_object() {
            let id = obj
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let name = obj
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let repo = obj
                .get("repo")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let query = obj
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let enabled = obj.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
            let notify = obj.get("notify").and_then(|v| v.as_bool()).unwrap_or(true);
            let color = obj
                .get("color")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if id.is_empty() {
                log::warn!("skipping legacy source record with no id: {item}");
                continue;
            }
            log::info!("migrating legacy source {id} to Repo kind");
            out.push(Source {
                id,
                name,
                enabled,
                color,
                notify,
                kind: SourceKind::Repo { repo, query },
            });
        }
    }
    out
}

pub fn save_sources(app: &AppHandle, sources: &[Source]) -> Result<()> {
    let store = store_handle(app)?;
    store.set(KEY_SOURCES, serde_json::to_value(sources)?);
    store.save().map_err(Error::from)?;
    Ok(())
}

pub fn upsert_source(app: &AppHandle, source: Source) -> Result<Source> {
    let mut sources = list_sources(app)?;
    if let Some(existing) = sources.iter_mut().find(|s| s.id == source.id) {
        *existing = source.clone();
    } else {
        sources.push(source.clone());
    }
    save_sources(app, &sources)?;
    Ok(source)
}

pub fn delete_source(app: &AppHandle, id: &str) -> Result<()> {
    let mut sources = list_sources(app)?;
    sources.retain(|s| s.id != id);
    save_sources(app, &sources)
}

pub fn load_settings(app: &AppHandle) -> Result<Settings> {
    let store = store_handle(app)?;
    let value = store.get(KEY_SETTINGS).unwrap_or(serde_json::Value::Null);
    if value.is_null() {
        Ok(Settings::default())
    } else {
        Ok(serde_json::from_value(value)?)
    }
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> Result<()> {
    let store = store_handle(app)?;
    store.set(KEY_SETTINGS, serde_json::to_value(settings)?);
    store.save().map_err(Error::from)?;
    Ok(())
}

/// Remember which issue IDs we've already notified about, so new ones generate
/// one notification each. Keyed by `source.id`.
pub fn load_seen(app: &AppHandle, source_id: &str) -> Result<Vec<String>> {
    let store = store_handle(app)?;
    let key = format!("seen:{source_id}");
    let v = store.get(&key).unwrap_or(serde_json::Value::Array(vec![]));
    Ok(serde_json::from_value(v).unwrap_or_default())
}

/// Whether `save_seen` has ever been called for this `source_id`. An empty
/// `Vec` from `load_seen` is ambiguous — it means either "never seeded" or
/// "seeded, but nothing was notifiable that time" — so notify-on-new logic
/// must check this, not `seen.is_empty()`, to avoid silently swallowing
/// genuinely-new items on a fetch that happens to follow a truly-empty one.
pub fn has_seen_baseline(app: &AppHandle, source_id: &str) -> bool {
    let Ok(store) = store_handle(app) else {
        return false;
    };
    store.get(format!("seen:{source_id}")).is_some()
}

pub fn save_seen(app: &AppHandle, source_id: &str, ids: &[String]) -> Result<()> {
    let store = store_handle(app)?;
    let key = format!("seen:{source_id}");
    store.set(key, serde_json::to_value(ids)?);
    store.save().map_err(Error::from)?;
    Ok(())
}

const KEY_AWAITING_SEEN: &str = "awaiting_last_opened";

/// Map of `node_id` -> ISO-8601 timestamp of when the user last opened that
/// item. An awaiting-item is "unaddressed" only if its triggering event is
/// newer than this timestamp (or absent).
pub fn load_awaiting_seen(
    app: &AppHandle,
) -> Result<std::collections::HashMap<String, String>> {
    let store = store_handle(app)?;
    let v = store
        .get(KEY_AWAITING_SEEN)
        .unwrap_or(serde_json::Value::Object(Default::default()));
    Ok(serde_json::from_value(v).unwrap_or_default())
}

/// Record that the user just opened `node_id` at `opened_at` (RFC3339), so the
/// item stops being "awaiting" until a newer event arrives.
pub fn mark_awaiting_seen(app: &AppHandle, node_id: &str, opened_at: &str) -> Result<()> {
    let store = store_handle(app)?;
    let mut map = load_awaiting_seen(app)?;
    map.insert(node_id.to_string(), opened_at.to_string());
    store.set(KEY_AWAITING_SEEN, serde_json::to_value(map)?);
    store.save().map_err(Error::from)?;
    Ok(())
}

/// GraphQL page cursors from the last successful sync of a project, in
/// page-order. Used by Stage-3 parallel-cursor refresh: after page 1 returns
/// its cursor, we fire pages 2..N concurrently using these as speculative
/// cursors. If the project's size has shifted, we patch up the tail
/// sequentially. First sync (no cursors) falls back to serial paging.
pub fn load_cursors(app: &AppHandle, source_id: &str) -> Result<Vec<String>> {
    let store = store_handle(app)?;
    let key = format!("cursors:{source_id}");
    let v = store.get(&key).unwrap_or(serde_json::Value::Array(vec![]));
    Ok(serde_json::from_value(v).unwrap_or_default())
}

pub fn save_cursors(app: &AppHandle, source_id: &str, cursors: &[String]) -> Result<()> {
    let store = store_handle(app)?;
    let key = format!("cursors:{source_id}");
    store.set(key, serde_json::to_value(cursors)?);
    store.save().map_err(Error::from)?;
    Ok(())
}

