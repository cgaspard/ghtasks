use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Wry};
use tauri_plugin_store::{Store, StoreExt};

const STORE_PATH: &str = "ghtasks.json";
const KEY_SOURCES: &str = "sources";
const KEY_SETTINGS: &str = "settings";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Source {
    pub id: String,
    pub name: String,
    /// `owner/name`
    pub repo: String,
    /// Raw GitHub search-issues query (without `repo:`; we'll prepend it).
    pub query: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default = "default_notify")]
    pub notify: bool,
}

fn default_enabled() -> bool {
    true
}
fn default_notify() -> bool {
    true
}

impl Source {
    /// Compose the full GitHub search query, scoping to this Source's repo.
    pub fn full_query(&self) -> String {
        let trimmed = self.query.trim();
        if trimmed.is_empty() {
            format!("repo:{} is:issue is:open", self.repo)
        } else {
            format!("repo:{} {}", self.repo, trimmed)
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
}

fn default_poll_secs() -> u64 {
    90
}

fn store_handle(app: &AppHandle) -> Result<Arc<Store<Wry>>> {
    app.store(STORE_PATH).map_err(Error::from)
}

pub fn list_sources(app: &AppHandle) -> Result<Vec<Source>> {
    let store = store_handle(app)?;
    let value = store.get(KEY_SOURCES).unwrap_or(serde_json::Value::Array(vec![]));
    let sources: Vec<Source> = serde_json::from_value(value).unwrap_or_default();
    Ok(sources)
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

pub fn save_seen(app: &AppHandle, source_id: &str, ids: &[String]) -> Result<()> {
    let store = store_handle(app)?;
    let key = format!("seen:{source_id}");
    store.set(key, serde_json::to_value(ids)?);
    store.save().map_err(Error::from)?;
    Ok(())
}
