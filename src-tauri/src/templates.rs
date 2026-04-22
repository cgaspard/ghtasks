//! GitHub issue-template discovery and parsing.
//!
//! Supports the three shapes GitHub renders in the "Create new issue"
//! picker:
//!
//! 1. Markdown templates under `.github/ISSUE_TEMPLATE/*.md` with
//!    frontmatter (`name`, `about`, `title`, `labels`, `assignees`).
//! 2. YAML issue forms under `.github/ISSUE_TEMPLATE/*.yml` / `*.yaml`
//!    with structured fields (input/textarea/dropdown/checkboxes/markdown).
//! 3. Legacy single `ISSUE_TEMPLATE.md` at repo root or under `docs/`
//!    or `.github/`.
//!
//! Also parses `config.yml` to read `blank_issues_enabled` and `contact_links`.

use crate::error::Result;
use base64::Engine as _;
use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://api.github.com";

/// One issue template from a repo, in the shape the frontend renders.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum IssueTemplate {
    /// Markdown template with frontmatter. `body` is the raw markdown
    /// after the frontmatter block (safe to drop straight into the
    /// textarea).
    #[serde(rename = "markdown")]
    Markdown {
        filename: String,
        name: String,
        about: Option<String>,
        title: Option<String>,
        #[serde(default)]
        labels: Vec<String>,
        #[serde(default)]
        assignees: Vec<String>,
        body: String,
    },

    /// YAML issue form with typed fields.
    #[serde(rename = "form")]
    Form {
        filename: String,
        name: String,
        description: Option<String>,
        title: Option<String>,
        #[serde(default)]
        labels: Vec<String>,
        #[serde(default)]
        assignees: Vec<String>,
        body: Vec<FormField>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum FormField {
    #[serde(rename = "markdown")]
    Markdown { value: String },

    #[serde(rename = "input")]
    Input {
        id: Option<String>,
        label: String,
        description: Option<String>,
        placeholder: Option<String>,
        default_value: Option<String>,
        required: bool,
    },

    #[serde(rename = "textarea")]
    Textarea {
        id: Option<String>,
        label: String,
        description: Option<String>,
        placeholder: Option<String>,
        default_value: Option<String>,
        render: Option<String>,
        required: bool,
    },

    #[serde(rename = "dropdown")]
    Dropdown {
        id: Option<String>,
        label: String,
        description: Option<String>,
        options: Vec<String>,
        default_index: Option<usize>,
        multiple: bool,
        required: bool,
    },

    #[serde(rename = "checkboxes")]
    Checkboxes {
        id: Option<String>,
        label: String,
        description: Option<String>,
        options: Vec<CheckboxOption>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct CheckboxOption {
    pub label: String,
    pub required: bool,
}

/// Result of discovering templates for a repo.
#[derive(Debug, Clone, Serialize)]
pub struct IssueTemplateSet {
    pub templates: Vec<IssueTemplate>,
    /// From `config.yml`. If `blank_issues_enabled == false`, the UI
    /// should hide the "Blank" option. Defaults to true when no config.
    pub blank_issues_enabled: bool,
}

// ---- GitHub Contents API shapes ------------------------------------

#[derive(Debug, Deserialize)]
struct ContentsFileEntry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: String,
    // `content` is only populated for individual-file requests, not
    // directory listings.
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    encoding: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ContentsResponse {
    Dir(Vec<ContentsFileEntry>),
    // We never read the inner value — the File variant exists so
    // `serde(untagged)` can match the single-file shape that the
    // contents API returns when the path is legacy ISSUE_TEMPLATE.md.
    File(#[allow(dead_code)] ContentsFileEntry),
}

fn auth_headers(token: &str) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        reqwest::header::ACCEPT,
        "application/vnd.github+json".parse().unwrap(),
    );
    h.insert("X-GitHub-Api-Version", "2022-11-28".parse().unwrap());
    h.insert(
        reqwest::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    h
}

/// Fetch the decoded file content at `path`, or `Ok(None)` if the path
/// doesn't exist. Other HTTP errors propagate.
async fn fetch_file(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
    path: &str,
) -> Result<Option<String>> {
    let url = format!("{API_BASE}/repos/{repo}/contents/{path}");
    let resp = crate::http_log::send_timed(
        client,
        "template_file",
        client.get(&url).headers(auth_headers(token)),
    )
    .await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        // Non-fatal: callers can treat a failed sub-fetch as "template
        // absent" rather than aborting the whole template set.
        log::debug!(
            "template file fetch non-200 for {path}: {}",
            resp.status()
        );
        return Ok(None);
    }
    let body: ContentsFileEntry = resp.json().await?;
    Ok(decode_content(&body))
}

/// Fetch the directory entries at `path`, or `Ok(None)` if not a directory
/// or missing.
async fn fetch_dir(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
    path: &str,
) -> Result<Option<Vec<ContentsFileEntry>>> {
    let url = format!("{API_BASE}/repos/{repo}/contents/{path}");
    let resp = crate::http_log::send_timed(
        client,
        "template_dir",
        client.get(&url).headers(auth_headers(token)),
    )
    .await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        log::debug!("template dir fetch non-200 for {path}: {}", resp.status());
        return Ok(None);
    }
    let body: ContentsResponse = resp.json().await?;
    match body {
        ContentsResponse::Dir(entries) => Ok(Some(entries)),
        ContentsResponse::File(_) => Ok(None),
    }
}

fn decode_content(entry: &ContentsFileEntry) -> Option<String> {
    if entry.encoding.as_deref() != Some("base64") {
        return entry.content.clone();
    }
    let raw = entry.content.as_ref()?;
    // GitHub wraps base64 at 60 cols with newlines.
    let cleaned: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(cleaned)
        .ok()?;
    String::from_utf8(bytes).ok()
}

// ---- Top-level entry point -----------------------------------------

/// Discover every issue template in `repo` and return them along with the
/// blank-issues flag from `config.yml`.
pub async fn list_issue_templates(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
) -> Result<IssueTemplateSet> {
    let mut templates: Vec<IssueTemplate> = Vec::new();

    // 1. `.github/ISSUE_TEMPLATE/` directory (most common).
    if let Some(entries) =
        fetch_dir(client, token, repo, ".github/ISSUE_TEMPLATE").await?
    {
        templates.extend(parse_dir_entries(client, token, repo, &entries).await);
    }

    // 2. Legacy single-file templates — only if we found nothing above.
    if templates.is_empty() {
        for path in [
            ".github/ISSUE_TEMPLATE.md",
            "docs/ISSUE_TEMPLATE.md",
            "ISSUE_TEMPLATE.md",
        ] {
            if let Some(text) = fetch_file(client, token, repo, path).await? {
                if let Some(t) = parse_markdown_template(path, &text) {
                    templates.push(t);
                    break;
                }
            }
        }
    }

    // 3. `config.yml` for `blank_issues_enabled`.
    let mut blank_issues_enabled = true;
    for cfg_path in [
        ".github/ISSUE_TEMPLATE/config.yml",
        ".github/ISSUE_TEMPLATE/config.yaml",
    ] {
        if let Some(text) = fetch_file(client, token, repo, cfg_path).await? {
            if let Ok(cfg) = serde_yaml::from_str::<IssueTemplateConfig>(&text) {
                if let Some(v) = cfg.blank_issues_enabled {
                    blank_issues_enabled = v;
                }
            }
            break;
        }
    }

    // Alphabetical by name for stable UI ordering.
    templates.sort_by(|a, b| template_name(a).cmp(template_name(b)));

    Ok(IssueTemplateSet {
        templates,
        blank_issues_enabled,
    })
}

fn template_name(t: &IssueTemplate) -> &str {
    match t {
        IssueTemplate::Markdown { name, .. } => name,
        IssueTemplate::Form { name, .. } => name,
    }
}

#[derive(Debug, Deserialize)]
struct IssueTemplateConfig {
    #[serde(default)]
    blank_issues_enabled: Option<bool>,
}

/// Walk the `.github/ISSUE_TEMPLATE/` directory listing, fetch each
/// file's content, and parse it into an `IssueTemplate`. Skips
/// `config.yml` and any non-file entries.
async fn parse_dir_entries(
    client: &reqwest::Client,
    token: &str,
    repo: &str,
    entries: &[ContentsFileEntry],
) -> Vec<IssueTemplate> {
    let mut out: Vec<IssueTemplate> = Vec::new();
    for entry in entries {
        if entry.kind != "file" {
            continue;
        }
        let lower = entry.name.to_lowercase();
        if lower == "config.yml" || lower == "config.yaml" {
            continue;
        }
        // Individual-file fetch is required because directory listings
        // don't include `content`.
        let text = match fetch_file(client, token, repo, &entry.path).await {
            Ok(Some(t)) => t,
            _ => continue,
        };
        let parsed = if lower.ends_with(".yml") || lower.ends_with(".yaml") {
            parse_yaml_form(&entry.path, &text)
        } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
            parse_markdown_template(&entry.path, &text)
        } else {
            None
        };
        if let Some(t) = parsed {
            out.push(t);
        }
    }
    out
}

// ---- Markdown-with-frontmatter parser ------------------------------

/// Parse `---\n<yaml>\n---\n<body>`. Returns `None` if the frontmatter
/// is missing or malformed — we skip rather than try to salvage.
fn parse_markdown_template(path: &str, text: &str) -> Option<IssueTemplate> {
    let (front, body) = split_frontmatter(text)?;
    #[derive(Deserialize)]
    struct Front {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        about: Option<String>,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        labels: Option<StringOrList>,
        #[serde(default)]
        assignees: Option<StringOrList>,
    }
    let meta: Front = serde_yaml::from_str(front).ok()?;
    let name = meta.name.unwrap_or_else(|| {
        // Fall back to filename without extension.
        std::path::Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(path)
            .to_string()
    });
    Some(IssueTemplate::Markdown {
        filename: path.to_string(),
        name,
        about: meta.about,
        title: meta.title,
        labels: meta.labels.map(|l| l.into_vec()).unwrap_or_default(),
        assignees: meta.assignees.map(|l| l.into_vec()).unwrap_or_default(),
        body: body.to_string(),
    })
}

fn split_frontmatter(text: &str) -> Option<(&str, &str)> {
    // Strip a leading BOM / whitespace.
    let stripped = text.trim_start_matches('\u{feff}');
    let rest = stripped.strip_prefix("---")?;
    // First line after --- must be a newline.
    let rest = rest.strip_prefix('\n').or_else(|| rest.strip_prefix("\r\n"))?;
    // Find the closing `---` on its own line.
    let closer = rest
        .find("\n---\n")
        .or_else(|| rest.find("\r\n---\r\n"))
        .or_else(|| rest.find("\n---\r\n"))
        .or_else(|| rest.find("\r\n---\n"))?;
    let front = &rest[..closer];
    // Skip past the closing block + the following newline.
    let after = &rest[closer..];
    let after = after
        .trim_start_matches('\n')
        .trim_start_matches('\r')
        .trim_start_matches("---")
        .trim_start_matches('\n')
        .trim_start_matches('\r');
    Some((front, after))
}

/// Frontmatter fields like `labels` and `assignees` accept either a
/// comma-separated string or a YAML list. Normalize both into `Vec<String>`.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum StringOrList {
    One(String),
    Many(Vec<String>),
}

impl StringOrList {
    fn into_vec(self) -> Vec<String> {
        match self {
            StringOrList::Many(v) => v.into_iter().map(|s| s.trim().to_string()).collect(),
            StringOrList::One(s) => s
                .split(',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect(),
        }
    }
}

// ---- Issue Forms YAML parser ---------------------------------------

fn parse_yaml_form(path: &str, text: &str) -> Option<IssueTemplate> {
    #[derive(Deserialize)]
    struct Raw {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        description: Option<String>,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        labels: Option<StringOrList>,
        #[serde(default)]
        assignees: Option<StringOrList>,
        #[serde(default)]
        body: Vec<RawField>,
    }

    #[derive(Deserialize)]
    struct RawField {
        #[serde(rename = "type")]
        kind: String,
        #[serde(default)]
        id: Option<String>,
        #[serde(default)]
        attributes: serde_yaml::Value,
        #[serde(default)]
        validations: serde_yaml::Value,
    }

    let raw: Raw = serde_yaml::from_str(text).ok()?;
    let name = raw.name.unwrap_or_else(|| {
        std::path::Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(path)
            .to_string()
    });

    let fields: Vec<FormField> = raw
        .body
        .into_iter()
        .filter_map(|f| convert_field(&f.kind, f.id, &f.attributes, &f.validations))
        .collect();

    Some(IssueTemplate::Form {
        filename: path.to_string(),
        name,
        description: raw.description,
        title: raw.title,
        labels: raw.labels.map(|l| l.into_vec()).unwrap_or_default(),
        assignees: raw.assignees.map(|l| l.into_vec()).unwrap_or_default(),
        body: fields,
    })
}

fn yaml_str<'a>(v: &'a serde_yaml::Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|v| v.as_str())
}

fn convert_field(
    kind: &str,
    id: Option<String>,
    attrs: &serde_yaml::Value,
    validations: &serde_yaml::Value,
) -> Option<FormField> {
    let required = validations
        .get("required")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    match kind.to_lowercase().as_str() {
        "markdown" => Some(FormField::Markdown {
            value: yaml_str(attrs, "value").unwrap_or_default().to_string(),
        }),
        "input" => Some(FormField::Input {
            id,
            label: yaml_str(attrs, "label")?.to_string(),
            description: yaml_str(attrs, "description").map(String::from),
            placeholder: yaml_str(attrs, "placeholder").map(String::from),
            default_value: yaml_str(attrs, "value").map(String::from),
            required,
        }),
        "textarea" => Some(FormField::Textarea {
            id,
            label: yaml_str(attrs, "label")?.to_string(),
            description: yaml_str(attrs, "description").map(String::from),
            placeholder: yaml_str(attrs, "placeholder").map(String::from),
            default_value: yaml_str(attrs, "value").map(String::from),
            render: yaml_str(attrs, "render").map(String::from),
            required,
        }),
        "dropdown" => {
            let options: Vec<String> = attrs
                .get("options")
                .and_then(|v| v.as_sequence())
                .map(|seq| {
                    seq.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            Some(FormField::Dropdown {
                id,
                label: yaml_str(attrs, "label")?.to_string(),
                description: yaml_str(attrs, "description").map(String::from),
                options,
                default_index: attrs
                    .get("default")
                    .and_then(|v| v.as_u64())
                    .map(|n| n as usize),
                multiple: attrs
                    .get("multiple")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                required,
            })
        }
        "checkboxes" => {
            let options: Vec<CheckboxOption> = attrs
                .get("options")
                .and_then(|v| v.as_sequence())
                .map(|seq| {
                    seq.iter()
                        .filter_map(|opt| {
                            let label = opt.get("label")?.as_str()?.to_string();
                            let required = opt
                                .get("required")
                                .and_then(|b| b.as_bool())
                                .unwrap_or(false);
                            Some(CheckboxOption { label, required })
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some(FormField::Checkboxes {
                id,
                label: yaml_str(attrs, "label")?.to_string(),
                description: yaml_str(attrs, "description").map(String::from),
                options,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_markdown_frontmatter() {
        let text = "---\nname: Bug\nabout: Report a bug\ntitle: \"[BUG] \"\nlabels: bug, help wanted\nassignees:\n  - octocat\n---\n\n## Steps to reproduce\n\n";
        let t = parse_markdown_template(".github/ISSUE_TEMPLATE/bug.md", text).unwrap();
        match t {
            IssueTemplate::Markdown {
                name,
                about,
                title,
                labels,
                assignees,
                body,
                ..
            } => {
                assert_eq!(name, "Bug");
                assert_eq!(about.as_deref(), Some("Report a bug"));
                assert_eq!(title.as_deref(), Some("[BUG] "));
                assert_eq!(labels, vec!["bug".to_string(), "help wanted".to_string()]);
                assert_eq!(assignees, vec!["octocat".to_string()]);
                assert!(body.starts_with("## Steps"));
            }
            _ => panic!("expected markdown"),
        }
    }

    #[test]
    fn falls_back_to_filename_when_name_missing() {
        let text = "---\nabout: thing\n---\nhi";
        let t = parse_markdown_template(".github/ISSUE_TEMPLATE/hardware_upgrade.md", text)
            .unwrap();
        match t {
            IssueTemplate::Markdown { name, .. } => assert_eq!(name, "hardware_upgrade"),
            _ => panic!("expected markdown"),
        }
    }

    #[test]
    fn parses_yaml_form() {
        let text = r#"
name: Bug report
description: File a bug
labels: [bug]
body:
  - type: markdown
    attributes:
      value: "Thanks for filing a bug!"
  - type: input
    id: version
    attributes:
      label: App version
      placeholder: v0.1.9
    validations:
      required: true
  - type: textarea
    id: repro
    attributes:
      label: Steps to reproduce
      render: bash
    validations:
      required: true
  - type: dropdown
    id: env
    attributes:
      label: Environment
      options:
        - macOS
        - Windows
        - Linux
      default: 0
  - type: checkboxes
    attributes:
      label: Confirmations
      options:
        - label: I have searched existing issues
          required: true
"#;
        let t = parse_yaml_form(".github/ISSUE_TEMPLATE/bug.yml", text).unwrap();
        match t {
            IssueTemplate::Form { name, body, .. } => {
                assert_eq!(name, "Bug report");
                assert_eq!(body.len(), 5);
            }
            _ => panic!("expected form"),
        }
    }
}
