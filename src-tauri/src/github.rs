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

/// A pull request development-linked to an issue (the "Closes #N" / sidebar
/// relationship that auto-closes the issue on merge). Sourced from GraphQL
/// `Issue.closedByPullRequestsReferences`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LinkedPr {
    pub number: u64,
    pub title: String,
    pub url: String,
    /// "open" | "closed" | "merged" (lowercased GraphQL PullRequestState).
    pub state: String,
    pub is_draft: bool,
    /// `owner/repo` of the PR — may differ from the issue's repo (cross-repo link).
    pub repo: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Milestone {
    #[serde(default)]
    pub title: String,
    /// The milestone's web URL. REST search returns this as `html_url` (it also
    /// returns an API `url` we don't want — aliasing both onto one field is a
    /// serde "duplicate field" error, so we deserialize *only* from `html_url`)
    /// while still serializing back to the frontend as `url`. The GraphQL path
    /// builds this struct by hand and sets `url` directly.
    #[serde(default, rename(deserialize = "html_url", serialize = "url"))]
    pub url: String,
    /// ISO-8601 due date, if set.
    #[serde(default)]
    pub due_on: Option<String>,
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
    #[serde(default)]
    pub linked_prs: Vec<LinkedPr>,
    #[serde(default)]
    pub milestone: Option<Milestone>,
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

/// The subject of a notification (the issue/PR/etc. it's about).
#[derive(Debug, Deserialize, Clone)]
pub struct NotificationSubject {
    pub title: String,
    /// API URL, e.g. `.../repos/o/r/issues/123` or `.../pulls/123`.
    pub url: Option<String>,
    /// "Issue" | "PullRequest" | "Release" | "Discussion" | ...
    #[serde(rename = "type")]
    pub subject_type: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct NotificationRepo {
    pub full_name: String,
}

/// A GitHub notification thread. See `GET /notifications`.
#[derive(Debug, Deserialize, Clone)]
pub struct Notification {
    pub id: String,
    /// Why this landed in your inbox: mention, review_requested, assign,
    /// team_mention, comment, author, subscribed, ci_activity, …
    pub reason: String,
    pub unread: bool,
    pub updated_at: String,
    pub subject: NotificationSubject,
    pub repository: NotificationRepo,
}

/// Mark a notification thread as read on GitHub (`PATCH /notifications/threads/
/// {id}`). Used when the "sync to GitHub" setting is on so triaging in-app also
/// clears the thread from the user's real inbox. Returns Ok on 205/reset too.
pub async fn mark_thread_read(client: &reqwest::Client, token: &str, thread_id: &str) -> Result<()> {
    let resp = crate::http_log::send_timed(
        client,
        "mark_thread_read",
        client
            .patch(format!("{API_BASE}/notifications/threads/{thread_id}"))
            .headers(auth_headers(token)),
    )
    .await?;
    let status = resp.status();
    // 205 Reset Content on success; 304 if already read. Both are fine.
    if status.is_success() || status.as_u16() == 304 {
        Ok(())
    } else {
        Err(Error::GitHub {
            status: status.as_u16(),
            message: resp.text().await.unwrap_or_default(),
        })
    }
}

/// One page of notifications, plus whether GitHub has more beyond it.
pub struct NotificationPage {
    pub items: Vec<Notification>,
    pub has_more: bool,
}

const NOTIFICATIONS_PER_PAGE: u32 = 50;

/// Fetch one page (1-indexed) of the user's notifications, 50 at a time.
/// `all=true` so read threads are included too (github.com/notifications
/// shows everything not Done, not just unread — the mirror needs to match).
/// `has_more` is true when this page came back full (a partial/empty page
/// means we've reached the end — GitHub's notifications endpoint doesn't
/// expose a total count, so page-fullness is the standard signal).
pub async fn list_notifications(
    client: &reqwest::Client,
    token: &str,
    participating: bool,
    page: u32,
) -> Result<NotificationPage> {
    let resp = crate::http_log::send_timed(
        client,
        "list_notifications",
        client
            .get(format!("{API_BASE}/notifications"))
            .headers(auth_headers(token))
            .query(&[
                ("all", "true"),
                ("participating", if participating { "true" } else { "false" }),
                ("per_page", &NOTIFICATIONS_PER_PAGE.to_string()),
                ("page", &page.to_string()),
            ]),
    )
    .await?;
    let items: Vec<Notification> = json(resp).await?;
    let has_more = items.len() as u32 == NOTIFICATIONS_PER_PAGE;
    Ok(NotificationPage { items, has_more })
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IssueComment {
    pub id: u64,
    pub node_id: String,
    pub html_url: String,
    pub user: Option<IssueUser>,
    pub body: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub author_association: Option<String>,
}

/// Fetch a single issue's full payload. The REST search endpoint returns a
/// trimmed shape; this gives us the body, closed_at, reactions, etc.
pub async fn get_issue(
    client: &reqwest::Client,
    token: &str,
    repo_full_name: &str,
    number: u64,
) -> Result<Issue> {
    let resp = crate::http_log::send_timed(
        client,
        "get_issue",
        client
            .get(format!(
                "{API_BASE}/repos/{repo_full_name}/issues/{number}"
            ))
            .headers(auth_headers(token)),
    )
    .await?;
    json(resp).await
}

/// Fetch every comment on an issue. Paginated at 100/page, capped at 500
/// — boards with more than that are rare and we surface a "see full
/// thread on GitHub" hint in the UI for anything truncated.
pub async fn list_issue_comments(
    client: &reqwest::Client,
    token: &str,
    repo_full_name: &str,
    number: u64,
) -> Result<Vec<IssueComment>> {
    let mut out: Vec<IssueComment> = Vec::new();
    for page in 1..=5u32 {
        let resp = crate::http_log::send_timed(
            client,
            "list_issue_comments",
            client
                .get(format!(
                    "{API_BASE}/repos/{repo_full_name}/issues/{number}/comments?per_page=100&page={page}&sort=created"
                ))
                .headers(auth_headers(token)),
        )
        .await?;
        let batch: Vec<IssueComment> = json(resp).await?;
        let got = batch.len();
        out.extend(batch);
        if got < 100 {
            break;
        }
    }
    Ok(out)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression: a REST search-issues item whose milestone object carries BOTH
    /// `url` and `html_url` must decode. Aliasing both onto one field was a serde
    /// "duplicate field" error that failed the whole search decode (v0.3.0 bug).
    #[test]
    fn milestone_with_both_url_and_html_url_decodes() {
        let json = r#"{
            "url": "https://api.github.com/repos/o/r/milestones/1",
            "html_url": "https://github.com/o/r/milestone/1",
            "id": 9, "number": 1, "state": "open",
            "title": "v1.0", "due_on": null
        }"#;
        let m: Milestone = serde_json::from_str(json).expect("milestone should decode");
        assert_eq!(m.title, "v1.0");
        // We want the WEB url (html_url), not the API url.
        assert_eq!(m.url, "https://github.com/o/r/milestone/1");
    }

    /// The milestone serializes back to the frontend as `url` (not `html_url`).
    #[test]
    fn milestone_serializes_url_key_for_frontend() {
        let m = Milestone {
            title: "v2".into(),
            url: "https://github.com/o/r/milestone/2".into(),
            due_on: None,
        };
        let out = serde_json::to_string(&m).unwrap();
        assert!(out.contains("\"url\""), "must serialize as `url`: {out}");
        assert!(!out.contains("html_url"), "must not leak html_url: {out}");
    }

    /// A full search-issues item with a milestone + PR-ness decodes end to end.
    #[test]
    fn search_issue_with_milestone_decodes() {
        let json = r#"{
            "id": 1, "node_id": "I_kw", "number": 1486, "title": "fix",
            "html_url": "h", "state": "open",
            "labels": [{"name": "bug", "color": "d73a4a"}],
            "user": {"login": "me", "avatar_url": "a"},
            "assignees": [{"login": "me", "avatar_url": "a"}],
            "repository_url": "https://api.github.com/repos/o/r",
            "body": null, "comments": 2,
            "updated_at": "2026-06-25T09:00:00Z", "created_at": "2026-06-20T09:00:00Z",
            "pull_request": {"url": "p"},
            "milestone": {"url": "api", "html_url": "web", "title": "v1", "due_on": null}
        }"#;
        let issue: Issue = serde_json::from_str(json).expect("issue should decode");
        assert_eq!(issue.number, 1486);
        assert_eq!(issue.milestone.unwrap().url, "web");
    }
}
