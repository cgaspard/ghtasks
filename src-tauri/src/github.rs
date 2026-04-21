use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://api.github.com";
const USER_AGENT: &str = concat!("ghtasks/", env!("CARGO_PKG_VERSION"));

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .expect("failed to build reqwest client")
}

fn auth_headers(token: &str) -> reqwest::header::HeaderMap {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        reqwest::header::ACCEPT,
        "application/vnd.github+json".parse().unwrap(),
    );
    h.insert(
        "X-GitHub-Api-Version",
        "2022-11-28".parse().unwrap(),
    );
    h.insert(
        reqwest::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    h
}

async fn json<T: for<'de> Deserialize<'de>>(resp: reqwest::Response) -> Result<T> {
    let status = resp.status();
    if !status.is_success() {
        let message = resp.text().await.unwrap_or_default();
        return Err(Error::GitHub {
            status: status.as_u16(),
            message,
        });
    }
    Ok(resp.json().await?)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct User {
    pub login: String,
    pub id: u64,
    pub avatar_url: String,
    pub name: Option<String>,
    pub html_url: String,
}

pub async fn get_authenticated_user(
    client: &reqwest::Client,
    token: &str,
) -> Result<User> {
    let resp = crate::http_log::send_timed(
        client,
        "get_user",
        client
            .get(format!("{API_BASE}/user"))
            .headers(auth_headers(token)),
    )
    .await?;
    json(resp).await
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Repo {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub html_url: String,
    pub description: Option<String>,
    #[serde(default)]
    pub archived: bool,
    pub open_issues_count: Option<u32>,
}

pub async fn list_user_repos(
    client: &reqwest::Client,
    token: &str,
) -> Result<Vec<Repo>> {
    let resp = crate::http_log::send_timed(
        client,
        "list_user_repos",
        client
            .get(format!(
                "{API_BASE}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member"
            ))
            .headers(auth_headers(token)),
    )
    .await?;
    json(resp).await
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueLabel {
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueUser {
    pub login: String,
    pub avatar_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Issue {
    pub id: u64,
    pub node_id: String,
    pub number: u64,
    pub title: String,
    pub html_url: String,
    pub state: String,
    #[serde(default)]
    pub labels: Vec<IssueLabel>,
    pub user: Option<IssueUser>,
    pub assignees: Option<Vec<IssueUser>>,
    pub repository_url: Option<String>,
    pub body: Option<String>,
    pub comments: Option<u32>,
    pub updated_at: String,
    pub created_at: String,
    pub pull_request: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse<T> {
    #[allow(dead_code)]
    total_count: u64,
    items: Vec<T>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoLabel {
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// List every label defined on a repo (paginated; 100 at a time, up to 500).
pub async fn list_repo_labels(
    client: &reqwest::Client,
    token: &str,
    repo_full_name: &str,
) -> Result<Vec<RepoLabel>> {
    let mut out: Vec<RepoLabel> = Vec::new();
    for page in 1..=5u32 {
        let resp = crate::http_log::send_timed(
            client,
            "list_repo_labels",
            client
                .get(format!(
                    "{API_BASE}/repos/{repo_full_name}/labels?per_page=100&page={page}"
                ))
                .headers(auth_headers(token)),
        )
        .await?;
        let batch: Vec<RepoLabel> = json(resp).await?;
        let got = batch.len();
        out.extend(batch);
        if got < 100 {
            break;
        }
    }
    Ok(out)
}

/// Run a GitHub search-issues query. `query` is a raw GitHub search string.
pub async fn search_issues(
    client: &reqwest::Client,
    token: &str,
    query: &str,
) -> Result<Vec<Issue>> {
    let resp = crate::http_log::send_timed(
        client,
        "search_issues",
        client
            .get(format!("{API_BASE}/search/issues"))
            .headers(auth_headers(token))
            .query(&[("q", query), ("per_page", "50"), ("sort", "updated")]),
    )
    .await?;
    let data: SearchResponse<Issue> = json(resp).await?;
    Ok(data.items)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NewIssueInput {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignees: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    pub issue_type: Option<String>,
}

pub async fn create_issue(
    client: &reqwest::Client,
    token: &str,
    repo_full_name: &str,
    input: &NewIssueInput,
) -> Result<Issue> {
    let resp = crate::http_log::send_timed(
        client,
        "create_issue",
        client
            .post(format!("{API_BASE}/repos/{repo_full_name}/issues"))
            .headers(auth_headers(token))
            .json(input),
    )
    .await?;
    json(resp).await
}

/// Close or reopen an issue.
pub async fn set_issue_state(
    client: &reqwest::Client,
    token: &str,
    repo_full_name: &str,
    number: u64,
    state: &str,
) -> Result<Issue> {
    let body = serde_json::json!({ "state": state });
    let resp = crate::http_log::send_timed(
        client,
        "set_issue_state",
        client
            .patch(format!(
                "{API_BASE}/repos/{repo_full_name}/issues/{number}"
            ))
            .headers(auth_headers(token))
            .json(&body),
    )
    .await?;
    json(resp).await
}
