//! GitHub Projects v2 support via the GraphQL API.
//!
//! We don't use a heavy GraphQL client — a single reqwest helper + serde is
//! enough for our small surface: list projects, fetch items, list fields,
//! mutate a field value.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const GRAPHQL_URL: &str = "https://api.github.com/graphql";

async fn graphql<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    token: &str,
    query: &str,
    variables: Value,
) -> Result<T> {
    let label = graphql_label(query);
    let resp = crate::http_log::send_timed(
        client,
        &format!("graphql:{label}"),
        client
            .post(GRAPHQL_URL)
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&json!({ "query": query, "variables": variables })),
    )
    .await?;

    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(Error::GitHub {
            status: status.as_u16(),
            message: raw,
        });
    }

    #[derive(Deserialize)]
    struct Envelope<D> {
        data: Option<D>,
        #[serde(default)]
        errors: Vec<GraphQlError>,
    }
    #[derive(Deserialize)]
    struct GraphQlError {
        message: String,
    }

    let env: Envelope<T> = serde_json::from_str(&raw).map_err(|e| {
        Error::Other(format!(
            "graphql: could not parse response: {e}; body: {raw}"
        ))
    })?;

    if !env.errors.is_empty() {
        let joined = env
            .errors
            .into_iter()
            .map(|e| e.message)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(Error::Other(format!("graphql errors: {joined}")));
    }
    env.data
        .ok_or_else(|| Error::Other("graphql: empty data".into()))
}

/// Extract the operation name from a GraphQL query (e.g. `query Foo(...)` →
/// `Foo`, `mutation Bar` → `Bar`). Used as a short label in latency logs.
fn graphql_label(query: &str) -> String {
    for line in query.lines() {
        let trimmed = line.trim();
        for prefix in ["query ", "mutation ", "subscription "] {
            if let Some(rest) = trimmed.strip_prefix(prefix) {
                return rest
                    .split(|c: char| c == '(' || c == '{' || c.is_whitespace())
                    .find(|s| !s.is_empty())
                    .unwrap_or("anon")
                    .to_string();
            }
        }
    }
    "anon".to_string()
}

// ---- list_projects -----------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectSummary {
    pub id: String,
    pub number: u32,
    pub title: String,
    pub owner_login: String,
    pub owner_type: String, // "user" | "organization"
    pub url: String,
    #[serde(default)]
    pub closed: bool,
}

const LIST_PROJECTS_QUERY: &str = r#"
query ListProjects {
  viewer {
    login
    projectsV2(first: 50) {
      nodes { id number title url closed owner { __typename ... on User { login } ... on Organization { login } } }
    }
    organizations(first: 50) {
      nodes {
        login
        projectsV2(first: 50) {
          nodes { id number title url closed owner { __typename ... on User { login } ... on Organization { login } } }
        }
      }
    }
  }
}
"#;

/// List all Projects v2 the authenticated user can see (their own + every
/// org they belong to). De-duped by project id.
pub async fn list_projects(
    client: &reqwest::Client,
    token: &str,
) -> Result<Vec<ProjectSummary>> {
    #[derive(Deserialize)]
    struct NodesOf<T> {
        nodes: Option<Vec<T>>,
    }
    impl<T> NodesOf<T> {
        fn into_vec(self) -> Vec<T> {
            self.nodes.unwrap_or_default()
        }
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct RawProject {
        id: String,
        number: u32,
        title: String,
        url: String,
        #[serde(default)]
        closed: bool,
        owner: Owner,
    }
    #[derive(Deserialize)]
    struct Owner {
        #[serde(rename = "__typename")]
        typename: String,
        #[serde(default)]
        login: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Resp {
        viewer: Viewer,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Viewer {
        projects_v2: NodesOf<RawProject>,
        organizations: NodesOf<Org>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Org {
        projects_v2: NodesOf<RawProject>,
    }

    let data: Resp = graphql(client, token, LIST_PROJECTS_QUERY, json!({})).await?;
    let mut out: Vec<ProjectSummary> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut push = |p: RawProject| {
        if p.closed {
            return;
        }
        if !seen.insert(p.id.clone()) {
            return;
        }
        let owner_type = match p.owner.typename.as_str() {
            "User" => "user",
            "Organization" => "organization",
            _ => "unknown",
        };
        out.push(ProjectSummary {
            id: p.id,
            number: p.number,
            title: p.title,
            owner_login: p.owner.login.unwrap_or_default(),
            owner_type: owner_type.into(),
            url: p.url,
            closed: false,
        });
    };
    for p in data.viewer.projects_v2.into_vec() {
        push(p);
    }
    for org in data.viewer.organizations.into_vec() {
        for p in org.projects_v2.into_vec() {
            push(p);
        }
    }
    out.sort_by(|a, b| {
        a.owner_login
            .to_lowercase()
            .cmp(&b.owner_login.to_lowercase())
            .then(a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    Ok(out)
}

// ---- fetch_project_items ----------------------------------------------

#[derive(Debug, Serialize, Clone)]
pub struct ProjectField {
    pub id: String,
    pub name: String,
    pub data_type: String, // TEXT | NUMBER | DATE | SINGLE_SELECT | ITERATION | etc.
    #[serde(default)]
    pub options: Vec<ProjectFieldOption>, // single_select options
}

#[derive(Debug, Serialize, Clone)]
pub struct ProjectFieldOption {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProjectItem {
    /// ProjectV2Item node id (used for mutations).
    pub item_id: String,
    /// Issue content. Draft items and PRs are filtered out upstream.
    pub issue: crate::github::Issue,
    pub repo: String,
    /// Normalized field values keyed by field id.
    pub field_values: Vec<ProjectItemFieldValue>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProjectItemFieldValue {
    pub field_id: String,
    pub field_name: String,
    pub data_type: String,
    /// For single-select fields.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub option_id: Option<String>,
    /// Display text (for any field type).
    pub text: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProjectSnapshot {
    pub project: ProjectSummary,
    pub fields: Vec<ProjectField>,
    pub items: Vec<ProjectItem>,
}

const PROJECT_FIELDS_QUERY: &str = r#"
query ProjectFields($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      id number title url closed
      owner { __typename ... on User { login } ... on Organization { login } }
      fields(first: 50) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField {
            id name dataType
            options { id name color }
          }
        }
      }
    }
  }
}
"#;

const PROJECT_ITEMS_QUERY: &str = r#"
query ProjectItems($id: ID!, $after: String, $q: String) {
  node(id: $id) {
    ... on ProjectV2 {
      items(first: 100, after: $after, query: $q) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            __typename
            ... on Issue {
              id number title url state updatedAt
              repository { nameWithOwner }
              assignees(first: 10) { nodes { login avatarUrl } }
              labels(first: 5) { nodes { name color } }
            }
          }
          fieldValues(first: 30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldTextValue {
                text
                field { ... on ProjectV2FieldCommon { id name dataType } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2FieldCommon { id name dataType } }
              }
              ... on ProjectV2ItemFieldDateValue {
                date
                field { ... on ProjectV2FieldCommon { id name dataType } }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                optionId name
                field { ... on ProjectV2FieldCommon { id name dataType } }
              }
              ... on ProjectV2ItemFieldIterationValue {
                title startDate
                field { ... on ProjectV2FieldCommon { id name dataType } }
              }
            }
          }
        }
      }
    }
  }
}
"#;

pub async fn fetch_project_snapshot(
    client: &reqwest::Client,
    token: &str,
    project_id: &str,
    items_query: &str,
) -> Result<ProjectSnapshot> {
    // Fields + page-1 of items run concurrently — they don't depend on each
    // other. Later pages still need cursors from the previous page.
    let fields_fut = graphql::<Value>(
        client,
        token,
        PROJECT_FIELDS_QUERY,
        json!({ "id": project_id }),
    );
    let first_page_fut = graphql::<Value>(
        client,
        token,
        PROJECT_ITEMS_QUERY,
        json!({
            "id": project_id,
            "after": Option::<String>::None,
            "q": items_query,
        }),
    );
    let (fields_raw, first_page_raw) = tokio::try_join!(fields_fut, first_page_fut)?;

    let node = fields_raw
        .get("node")
        .cloned()
        .ok_or_else(|| Error::Other("project not found".into()))?;
    let project = parse_project_summary(&node)?;
    let fields = parse_project_fields(&node);

    // Process the first page we already have, then keep paging.
    let mut items: Vec<ProjectItem> = Vec::new();
    let mut page_raw = first_page_raw;
    loop {
        let items_node = page_raw
            .pointer("/node/items")
            .cloned()
            .ok_or_else(|| Error::Other("project.items missing".into()))?;
        let nodes = items_node
            .get("nodes")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for n in nodes {
            if let Some(item) = parse_project_item(&n) {
                items.push(item);
            }
        }
        let page = items_node.get("pageInfo");
        let has_next = page
            .and_then(|p| p.get("hasNextPage"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !has_next {
            break;
        }
        let after: Option<String> = page
            .and_then(|p| p.get("endCursor"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if after.is_none() {
            break;
        }
        page_raw = graphql(
            client,
            token,
            PROJECT_ITEMS_QUERY,
            json!({
                "id": project_id,
                "after": after,
                "q": items_query,
            }),
        )
        .await?;
    }

    Ok(ProjectSnapshot {
        project,
        fields,
        items,
    })
}

/// Payload emitted for each page during a streaming fetch.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectPageEvent {
    /// The source id the caller knows this project by.
    pub source_id: String,
    /// Full project metadata. Populated on every page (cheap).
    pub project: ProjectSummary,
    /// All fields; populated on the first page only (empty vec on later pages).
    pub fields: Vec<ProjectField>,
    /// Items from this page. Caller appends.
    pub items: Vec<ProjectItem>,
    /// `true` on the first page of the stream.
    pub is_first: bool,
    /// `true` on the last page of the stream.
    pub is_final: bool,
    /// Any error that terminated the stream early.
    pub error: Option<String>,
}

/// Like `fetch_project_snapshot` but emits each page via a callback as soon
/// as it's parsed. The callback runs on the current task. On error, the
/// callback is invoked once with `error: Some(...)` and `is_final: true`.
pub async fn stream_project_snapshot<F>(
    client: &reqwest::Client,
    token: &str,
    source_id: &str,
    project_id: &str,
    items_query: &str,
    prior_cursors: &[String],
    mut on_page: F,
) -> Vec<String>
where
    F: FnMut(ProjectPageEvent),
{
    log::info!(
        "stream_project_snapshot: source={source_id} filter={:?} prior_cursors={}",
        items_query,
        prior_cursors.len()
    );
    // Fields + first page in parallel.
    let fields_fut = graphql::<Value>(
        client,
        token,
        PROJECT_FIELDS_QUERY,
        json!({ "id": project_id }),
    );
    let first_page_fut = graphql::<Value>(
        client,
        token,
        PROJECT_ITEMS_QUERY,
        json!({
            "id": project_id,
            "after": Option::<String>::None,
            "q": items_query,
        }),
    );
    let (fields_raw, first_page_raw) = match tokio::try_join!(fields_fut, first_page_fut) {
        Ok(t) => t,
        Err(e) => {
            on_page(ProjectPageEvent {
                source_id: source_id.to_string(),
                project: placeholder_project(project_id),
                fields: vec![],
                items: vec![],
                is_first: true,
                is_final: true,
                error: Some(e.to_string()),
            });
            return vec![];
        }
    };

    let node = match fields_raw.get("node").cloned() {
        Some(n) => n,
        None => {
            on_page(ProjectPageEvent {
                source_id: source_id.to_string(),
                project: placeholder_project(project_id),
                fields: vec![],
                items: vec![],
                is_first: true,
                is_final: true,
                error: Some("project not found".into()),
            });
            return vec![];
        }
    };

    let project = match parse_project_summary(&node) {
        Ok(p) => p,
        Err(e) => {
            on_page(ProjectPageEvent {
                source_id: source_id.to_string(),
                project: placeholder_project(project_id),
                fields: vec![],
                items: vec![],
                is_first: true,
                is_final: true,
                error: Some(e.to_string()),
            });
            return vec![];
        }
    };
    let fields = parse_project_fields(&node);

    // Collected cursors we'll persist for next-time speculation. These are
    // the `endCursor` values of successful pages, in page order.
    let mut collected_cursors: Vec<String> = Vec::new();

    // --- Page 1 (already fetched) ----------------------------------------
    let (page1_items, page1_has_next, page1_end_cursor, page1_total) =
        match parse_items_page(&first_page_raw) {
            Some(p) => p,
            None => {
                on_page(ProjectPageEvent {
                    source_id: source_id.to_string(),
                    project: project.clone(),
                    fields: fields.clone(),
                    items: vec![],
                    is_first: true,
                    is_final: true,
                    error: Some("project.items missing".into()),
                });
                return vec![];
            }
        };
    log::info!(
        "stream_project_snapshot: source={source_id} server total_matching={page1_total}"
    );

    // If this is the only page, we're done after emitting it.
    if !page1_has_next {
        on_page(ProjectPageEvent {
            source_id: source_id.to_string(),
            project: project.clone(),
            fields: fields.clone(),
            items: page1_items,
            is_first: true,
            is_final: true,
            error: None,
        });
        return collected_cursors;
    }

    // Capture page-1 cursor so the next sync can parallelize including it.
    if let Some(c) = page1_end_cursor.clone() {
        collected_cursors.push(c);
    }

    // Emit page 1 immediately (non-final because we know there's more).
    on_page(ProjectPageEvent {
        source_id: source_id.to_string(),
        project: project.clone(),
        fields: fields.clone(),
        items: page1_items,
        is_first: true,
        is_final: false,
        error: None,
    });

    // --- Parallel-cursor batch (pages 2..prior_cursors.len()+1) ---------
    // prior_cursors[i] is the endCursor of page (i+1), which is the
    // `after` for page (i+2). So prior_cursors.len() additional pages can
    // be fired speculatively. First sync: prior_cursors is empty → skip.
    let mut last_serial_cursor: Option<String> = page1_end_cursor;
    if !prior_cursors.is_empty() {
        let mut futs = Vec::with_capacity(prior_cursors.len());
        for (i, cur) in prior_cursors.iter().enumerate() {
            let c = client.clone();
            let tok = token.to_string();
            let pid = project_id.to_string();
            let q = items_query.to_string();
            let cursor = cur.clone();
            futs.push(tokio::spawn(async move {
                let result = graphql::<Value>(
                    &c,
                    &tok,
                    PROJECT_ITEMS_QUERY,
                    json!({ "id": pid, "after": cursor, "q": q }),
                )
                .await;
                (i, result)
            }));
        }

        // Collect in-order so we can persist the cursor chain correctly.
        let mut outcomes: Vec<Option<(Vec<ProjectItem>, bool, Option<String>)>> =
            vec![None; prior_cursors.len()];
        for h in futs {
            match h.await {
                Ok((i, Ok(raw))) => {
                    if let Some((items, has_next, end)) =
                        parse_items_page(&raw).map(|(it, hn, ec, _tot)| (it, hn, ec))
                    {
                        outcomes[i] = Some((items, has_next, end));
                    } else {
                        log::warn!(
                            "parallel-cursor page {i} parse failed for source={source_id}"
                        );
                    }
                }
                Ok((i, Err(e))) => {
                    log::warn!(
                        "parallel-cursor page {i} request failed for source={source_id}: {e}"
                    );
                }
                Err(e) => {
                    log::warn!(
                        "parallel-cursor join error for source={source_id}: {e}"
                    );
                }
            }
        }

        // Emit in cursor order; stop at first missing / broken page so we
        // can serial-recover from that point.
        let mut hit_gap = false;
        for (i, outcome) in outcomes.into_iter().enumerate() {
            if hit_gap {
                break;
            }
            match outcome {
                Some((items, has_next, end)) => {
                    if let Some(ref c) = end {
                        collected_cursors.push(c.clone());
                    }
                    last_serial_cursor = end.clone();
                    let is_final_guess = !has_next && i + 1 == prior_cursors.len();
                    on_page(ProjectPageEvent {
                        source_id: source_id.to_string(),
                        project: project.clone(),
                        fields: vec![],
                        items,
                        is_first: false,
                        // We don't KNOW this is final until serial-tail check
                        // below confirms, but if the cursor set matched the
                        // project exactly, this is the final page.
                        is_final: is_final_guess,
                        error: None,
                    });
                    if !has_next {
                        // Parallel batch completed the project exactly.
                        return collected_cursors;
                    }
                }
                None => {
                    hit_gap = true;
                }
            }
        }
    }

    // --- Serial tail (first sync OR stale cursor set) -------------------
    // Starting from `last_serial_cursor`, keep pulling until hasNextPage is
    // false. Emits one event per page with is_final on the last.
    loop {
        let after = match last_serial_cursor.clone() {
            Some(c) => c,
            None => break,
        };
        let raw = match graphql::<Value>(
            client,
            token,
            PROJECT_ITEMS_QUERY,
            json!({
                "id": project_id,
                "after": after,
                "q": items_query,
            }),
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                on_page(ProjectPageEvent {
                    source_id: source_id.to_string(),
                    project: project.clone(),
                    fields: vec![],
                    items: vec![],
                    is_first: false,
                    is_final: true,
                    error: Some(e.to_string()),
                });
                return collected_cursors;
            }
        };
        let (items, has_next, end, _) = match parse_items_page(&raw) {
            Some(p) => p,
            None => {
                on_page(ProjectPageEvent {
                    source_id: source_id.to_string(),
                    project: project.clone(),
                    fields: vec![],
                    items: vec![],
                    is_first: false,
                    is_final: true,
                    error: Some("project.items missing".into()),
                });
                return collected_cursors;
            }
        };
        if let Some(ref c) = end {
            collected_cursors.push(c.clone());
        }
        on_page(ProjectPageEvent {
            source_id: source_id.to_string(),
            project: project.clone(),
            fields: vec![],
            items,
            is_first: false,
            is_final: !has_next,
            error: None,
        });
        if !has_next {
            return collected_cursors;
        }
        last_serial_cursor = end;
    }

    collected_cursors
}

/// Parse one page of `items` from a raw GraphQL response. Returns
/// (items, has_next_page, end_cursor, total_count). Returns None when the
/// expected JSON shape is missing entirely.
fn parse_items_page(
    raw: &Value,
) -> Option<(Vec<ProjectItem>, bool, Option<String>, u64)> {
    let items_node = raw.pointer("/node/items")?;
    let nodes = items_node
        .get("nodes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let items: Vec<ProjectItem> = nodes
        .iter()
        .filter_map(|n| parse_project_item(n))
        .collect();
    let page_info = items_node.get("pageInfo");
    let has_next = page_info
        .and_then(|p| p.get("hasNextPage"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let end_cursor = page_info
        .and_then(|p| p.get("endCursor"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let total = items_node
        .get("totalCount")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    Some((items, has_next, end_cursor, total))
}

fn placeholder_project(id: &str) -> ProjectSummary {
    ProjectSummary {
        id: id.to_string(),
        number: 0,
        title: String::new(),
        owner_login: String::new(),
        owner_type: String::new(),
        url: String::new(),
        closed: false,
    }
}

fn parse_project_summary(node: &Value) -> Result<ProjectSummary> {
    let id = node
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| Error::Other("project.id missing".into()))?
        .to_string();
    let number = node.get("number").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
    let title = node
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let url = node
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let closed = node
        .get("closed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let owner = node.get("owner");
    let owner_login = owner
        .and_then(|o| o.get("login"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let owner_type = match owner
        .and_then(|o| o.get("__typename"))
        .and_then(|v| v.as_str())
    {
        Some("User") => "user",
        Some("Organization") => "organization",
        _ => "unknown",
    }
    .to_string();
    Ok(ProjectSummary {
        id,
        number,
        title,
        url,
        closed,
        owner_login,
        owner_type,
    })
}

fn parse_project_fields(node: &Value) -> Vec<ProjectField> {
    let Some(nodes) = node.pointer("/fields/nodes").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    nodes
        .iter()
        .filter_map(|f| {
            let id = f.get("id")?.as_str()?.to_string();
            let name = f.get("name")?.as_str()?.to_string();
            let data_type = f
                .get("dataType")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let options = f
                .get("options")
                .and_then(|v| v.as_array())
                .map(|opts| {
                    opts.iter()
                        .filter_map(|o| {
                            Some(ProjectFieldOption {
                                id: o.get("id")?.as_str()?.to_string(),
                                name: o.get("name")?.as_str()?.to_string(),
                                color: o
                                    .get("color")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string()),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some(ProjectField {
                id,
                name,
                data_type,
                options,
            })
        })
        .collect()
}

fn parse_project_item(n: &Value) -> Option<ProjectItem> {
    let item_id = n.get("id")?.as_str()?.to_string();
    let content = n.get("content")?;
    // Only support Issue items in phase 1.
    if content.get("__typename").and_then(|v| v.as_str()) != Some("Issue") {
        return None;
    }
    let repo = content
        .pointer("/repository/nameWithOwner")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let issue = parse_graphql_issue(content, &repo)?;

    let mut field_values: Vec<ProjectItemFieldValue> = Vec::new();
    if let Some(fvs) = n.pointer("/fieldValues/nodes").and_then(|v| v.as_array()) {
        for fv in fvs {
            let field = fv.get("field");
            let field_id = field
                .and_then(|f| f.get("id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let field_name = field
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let data_type = field
                .and_then(|f| f.get("dataType"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if field_id.is_empty() {
                continue;
            }
            let typename = fv.get("__typename").and_then(|v| v.as_str()).unwrap_or("");
            let (option_id, text) = match typename {
                "ProjectV2ItemFieldTextValue" => (
                    None,
                    fv.get("text").and_then(|v| v.as_str()).map(|s| s.to_string()),
                ),
                "ProjectV2ItemFieldNumberValue" => (
                    None,
                    fv.get("number")
                        .and_then(|v| v.as_f64())
                        .map(|n| format_number(n)),
                ),
                "ProjectV2ItemFieldDateValue" => (
                    None,
                    fv.get("date").and_then(|v| v.as_str()).map(|s| s.to_string()),
                ),
                "ProjectV2ItemFieldSingleSelectValue" => (
                    fv.get("optionId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    fv.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                ),
                "ProjectV2ItemFieldIterationValue" => (
                    None,
                    fv.get("title").and_then(|v| v.as_str()).map(|s| s.to_string()),
                ),
                _ => (None, None),
            };
            field_values.push(ProjectItemFieldValue {
                field_id,
                field_name,
                data_type,
                option_id,
                text,
            });
        }
    }

    Some(ProjectItem {
        item_id,
        issue,
        repo,
        field_values,
    })
}

fn format_number(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// GraphQL Issue shape → reuse the REST Issue struct for the frontend. Fill
/// missing-from-GraphQL fields with sensible defaults.
fn parse_graphql_issue(content: &Value, repo: &str) -> Option<crate::github::Issue> {
    use crate::github::{Issue, IssueLabel, IssueUser};
    let number = content.get("number").and_then(|v| v.as_u64())?;
    let title = content
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let url = content
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let state = content
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("OPEN")
        .to_lowercase();
    // `body` intentionally not fetched in list view — saves ~40% payload on
    // big projects. Detail view (future) can fetch on demand.
    let body: Option<String> = None;
    let updated_at = content
        .get("updatedAt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let created_at = content
        .get("createdAt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let comments = content
        .pointer("/comments/totalCount")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);
    let labels = content
        .pointer("/labels/nodes")
        .and_then(|v| v.as_array())
        .map(|nodes| {
            nodes
                .iter()
                .filter_map(|n| {
                    Some(IssueLabel {
                        name: n.get("name")?.as_str()?.to_string(),
                        color: n
                            .get("color")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let author = content.get("author");
    let user = author.and_then(|a| {
        Some(IssueUser {
            login: a.get("login")?.as_str()?.to_string(),
            avatar_url: a
                .get("avatarUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
    });
    let assignees = content
        .pointer("/assignees/nodes")
        .and_then(|v| v.as_array())
        .map(|nodes| {
            nodes
                .iter()
                .filter_map(|n| {
                    Some(IssueUser {
                        login: n.get("login")?.as_str()?.to_string(),
                        avatar_url: n
                            .get("avatarUrl")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    })
                })
                .collect::<Vec<_>>()
        });

    // Synthesize REST-shaped repository_url for the frontend's repoFullName().
    let repository_url = if repo.is_empty() {
        None
    } else {
        Some(format!("https://api.github.com/repos/{repo}"))
    };

    Some(Issue {
        id: 0,
        node_id: content
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        number,
        title,
        html_url: url,
        state,
        labels,
        user,
        assignees,
        repository_url,
        body,
        comments,
        updated_at,
        created_at,
        pull_request: None,
    })
}

// ---- set_project_item_field --------------------------------------------

const SET_SINGLE_SELECT_MUTATION: &str = r#"
mutation SetSingleSelect($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(
    input: {
      projectId: $project
      itemId: $item
      fieldId: $field
      value: { singleSelectOptionId: $option }
    }
  ) {
    projectV2Item { id }
  }
}
"#;

const CLEAR_FIELD_MUTATION: &str = r#"
mutation ClearField($project: ID!, $item: ID!, $field: ID!) {
  clearProjectV2ItemFieldValue(
    input: { projectId: $project, itemId: $item, fieldId: $field }
  ) {
    projectV2Item { id }
  }
}
"#;

/// Set a single-select field. Pass `Some(option_id)` to set, or `None` to
/// clear the value (sets the item to "No Status"-style).
pub async fn set_single_select_field(
    client: &reqwest::Client,
    token: &str,
    project_id: &str,
    item_id: &str,
    field_id: &str,
    option_id: Option<&str>,
) -> Result<()> {
    match option_id {
        Some(opt) => {
            let _: Value = graphql(
                client,
                token,
                SET_SINGLE_SELECT_MUTATION,
                json!({
                    "project": project_id,
                    "item": item_id,
                    "field": field_id,
                    "option": opt,
                }),
            )
            .await?;
        }
        None => {
            let _: Value = graphql(
                client,
                token,
                CLEAR_FIELD_MUTATION,
                json!({
                    "project": project_id,
                    "item": item_id,
                    "field": field_id,
                }),
            )
            .await?;
        }
    }
    Ok(())
}

// ---- add_item_to_project ----------------------------------------------

const ADD_ITEM_MUTATION: &str = r#"
mutation AddItem($project: ID!, $content: ID!) {
  addProjectV2ItemById(input: { projectId: $project, contentId: $content }) {
    item { id }
  }
}
"#;

/// Attach an existing Issue/PR (by its node id) to a ProjectV2. Returns the
/// created ProjectV2Item's node id, which is needed to set field values.
pub async fn add_item_to_project(
    client: &reqwest::Client,
    token: &str,
    project_id: &str,
    content_id: &str,
) -> Result<String> {
    let resp: Value = graphql(
        client,
        token,
        ADD_ITEM_MUTATION,
        json!({ "project": project_id, "content": content_id }),
    )
    .await?;
    let item_id = resp
        .pointer("/addProjectV2ItemById/item/id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| Error::Other("addProjectV2ItemById: missing item.id".into()))?
        .to_string();
    Ok(item_id)
}

// ---- add_issue_comment (used by both Repo and Project issues) ---------

pub async fn add_issue_comment(
    client: &reqwest::Client,
    token: &str,
    repo_full_name: &str,
    number: u64,
    body: &str,
) -> Result<()> {
    let url = format!(
        "https://api.github.com/repos/{repo_full_name}/issues/{number}/comments"
    );
    let resp = crate::http_log::send_timed(
        client,
        "add_issue_comment",
        client
            .post(&url)
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .json(&json!({ "body": body })),
    )
    .await?;
    let status = resp.status();
    if !status.is_success() {
        let msg = resp.text().await.unwrap_or_default();
        return Err(Error::GitHub {
            status: status.as_u16(),
            message: msg,
        });
    }
    Ok(())
}
