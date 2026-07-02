//! GitHub notification inbox mirror.
//!
//! Pulls the user's notification threads (`GET /notifications`) and presents
//! them like github.com/notifications: all reasons, read + unread, filterable.
//! This deliberately mirrors GitHub rather than curating an opinionated
//! "awaiting" subset — the inbox IS the source of truth.
//!
//! We still classify each thread's `reason` so the UI can offer GitHub's
//! default filter chips (Review requested / Mentioned / Participating /
//! Assigned) and so the desktop notification only fires for the
//! "needs-a-response" reasons (not every subscribed/CI update).

use crate::error::Result;
use crate::github::{Issue, Notification};
use serde::Serialize;

/// GitHub's inbox groups reasons. We keep the raw reason string on the item and
/// derive this for filtering + notification gating.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum InboxCategory {
    ReviewRequested,
    Mentioned,
    Participating,
    Assigned,
    /// Everything else that still belongs in the inbox (author, subscribed,
    /// ci_activity, state_change, manual, …).
    Other,
}

impl InboxCategory {
    /// Classify a GitHub notification `reason` into an inbox filter category.
    fn from_reason(reason: &str) -> Self {
        match reason {
            "review_requested" => InboxCategory::ReviewRequested,
            "mention" | "team_mention" => InboxCategory::Mentioned,
            "comment" => InboxCategory::Participating,
            "assign" => InboxCategory::Assigned,
            _ => InboxCategory::Other,
        }
    }

    /// Whether an item in this category should raise a desktop notification when
    /// it newly appears unread. The inbox shows everything; we only *ping* for
    /// things that need a response.
    fn is_notifiable(self) -> bool {
        matches!(
            self,
            InboxCategory::ReviewRequested
                | InboxCategory::Mentioned
                | InboxCategory::Participating
        )
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct InboxItem {
    pub issue: Issue,
    /// Raw GitHub notification reason (assign, mention, review_requested,
    /// comment, author, subscribed, ci_activity, state_change, manual, …).
    pub reason: String,
    /// Filter category derived from the reason.
    pub category: InboxCategory,
    /// True if the underlying subject is a pull request.
    pub is_pr: bool,
    /// GitHub notification thread id (for mark-read sync).
    pub thread_id: String,
    /// Whether the notification is unread (drives the unread badge + styling).
    pub unread: bool,
    /// ISO-8601 timestamp the thread was last updated.
    pub event_at: String,
}

impl InboxItem {
    pub fn key(&self) -> &str {
        &self.issue.node_id
    }

    /// Whether this item should raise a desktop notification (new + unread +
    /// a needs-response category).
    pub fn is_notifiable(&self) -> bool {
        self.unread && self.category.is_notifiable()
    }

    /// Desktop-notification (title, body). OS notifications on desktop can't
    /// carry action buttons (Tauri's Actions API is mobile-only), so the body
    /// leads with the reference (repo + PR/issue #N, which survives truncation).
    pub fn notification(&self) -> (String, String) {
        let repo = self
            .issue
            .repository_url
            .as_deref()
            .and_then(|u| u.rsplit("/repos/").next())
            .unwrap_or("");
        let n = self.issue.number;
        let title = &self.issue.title;
        let kind = if self.is_pr { "PR" } else { "issue" };
        let heading = match self.category {
            InboxCategory::ReviewRequested => "Review requested",
            InboxCategory::Mentioned => "You were mentioned",
            InboxCategory::Participating => "New reply",
            InboxCategory::Assigned => "Assigned to you",
            InboxCategory::Other => "Notification",
        };
        let body = format!("{repo} {kind} #{n} · {title} — open GH Tasks to view");
        (heading.to_string(), body)
    }

    /// `(owner, name, number)` for the state-lookup query.
    fn repo_parts(&self) -> Option<(String, String, u64)> {
        let url = self.issue.repository_url.as_deref()?;
        let tail = url.split("/repos/").nth(1)?;
        let (owner, name) = tail.split_once('/')?;
        if owner.is_empty() || name.is_empty() {
            return None;
        }
        Some((owner.to_string(), name.to_string(), self.issue.number))
    }
}

/// Parse a notification `subject.url` into `(owner/name, number, is_pr)`.
fn parse_subject_url(url: &str) -> Option<(String, u64, bool)> {
    let tail = url.split("/repos/").nth(1)?;
    let parts: Vec<&str> = tail.split('/').collect();
    if parts.len() < 4 {
        return None;
    }
    let owner = parts[0];
    let name = parts[1];
    let is_pr = parts[2] == "pulls";
    let number: u64 = parts[3].parse().ok()?;
    if owner.is_empty() || name.is_empty() {
        return None;
    }
    Some((format!("{owner}/{name}"), number, is_pr))
}

/// Build an `InboxItem` from a notification, or `None` if the subject isn't an
/// addressable issue/PR (skip Release/Discussion/CheckSuite/etc.).
fn item_from_notification(n: &Notification) -> Option<InboxItem> {
    if n.subject.subject_type != "Issue" && n.subject.subject_type != "PullRequest" {
        return None;
    }
    let url = n.subject.url.as_deref()?;
    let (repo, number, is_pr) = parse_subject_url(url)?;
    let (owner, name) = repo.split_once('/')?;
    let path = if is_pr { "pull" } else { "issues" };
    let html_url = format!("https://github.com/{owner}/{name}/{path}/{number}");

    let issue = Issue {
        id: 0,
        node_id: format!("notif:{}", n.id),
        number,
        title: n.subject.title.clone(),
        html_url,
        state: "open".into(),
        labels: vec![],
        user: None,
        assignees: None,
        repository_url: Some(format!("https://api.github.com/repos/{repo}")),
        body: None,
        comments: None,
        updated_at: n.updated_at.clone(),
        created_at: String::new(),
        pull_request: if is_pr {
            Some(serde_json::json!({}))
        } else {
            None
        },
        linked_prs: vec![],
        milestone: None,
    };

    Some(InboxItem {
        category: InboxCategory::from_reason(&n.reason),
        is_pr,
        thread_id: n.id.clone(),
        unread: n.unread,
        event_at: n.updated_at.clone(),
        reason: n.reason.clone(),
        issue,
    })
}

/// Fetch the user's notification inbox — read AND unread threads (mirroring
/// github.com/notifications). Closed/merged items that linger in the feed are
/// dropped via a batched GraphQL state check.
pub async fn fetch_inbox(client: &reqwest::Client, token: &str) -> Result<Vec<InboxItem>> {
    // `all=true` so the mirror shows read items too (GitHub's default inbox is
    // "everything not Done", not unread-only). `participating=false` to match
    // the full inbox rather than only threads you're directly in.
    let notifications = crate::github::list_notifications(client, token, false).await?;

    let candidates: Vec<InboxItem> = notifications
        .iter()
        .filter_map(item_from_notification)
        .collect();

    // Drop closed/merged items (a notification lingers after its PR closes).
    let targets: Vec<crate::projects::EnrichTarget> = candidates
        .iter()
        .filter_map(|item| {
            item.repo_parts().map(|(owner, name, number)| {
                crate::projects::EnrichTarget { owner, name, number }
            })
        })
        .collect();
    let states = crate::projects::fetch_issue_states(client, token, &targets)
        .await
        .unwrap_or_default();

    let mut out: Vec<InboxItem> = candidates
        .into_iter()
        .filter(|item| match item.repo_parts() {
            Some((owner, name, number)) => {
                match states.get(&format!("{owner}/{name}#{number}")) {
                    Some(state) => state == "open",
                    None => true,
                }
            }
            None => true,
        })
        .collect();
    // Unread first, then newest.
    out.sort_by(|a, b| {
        b.unread
            .cmp(&a.unread)
            .then_with(|| b.event_at.cmp(&a.event_at))
    });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notif(reason: &str, subject_type: &str, url: &str, unread: bool) -> Notification {
        use crate::github::{NotificationRepo, NotificationSubject};
        Notification {
            id: "N1".into(),
            reason: reason.into(),
            unread,
            updated_at: "2026-06-25T09:00:00Z".into(),
            subject: NotificationSubject {
                title: "T".into(),
                url: Some(url.into()),
                subject_type: subject_type.into(),
            },
            repository: NotificationRepo {
                full_name: "safeevac/monorepo".into(),
            },
        }
    }

    #[test]
    fn classifies_reasons_into_categories() {
        assert_eq!(InboxCategory::from_reason("review_requested"), InboxCategory::ReviewRequested);
        assert_eq!(InboxCategory::from_reason("mention"), InboxCategory::Mentioned);
        assert_eq!(InboxCategory::from_reason("team_mention"), InboxCategory::Mentioned);
        assert_eq!(InboxCategory::from_reason("comment"), InboxCategory::Participating);
        assert_eq!(InboxCategory::from_reason("assign"), InboxCategory::Assigned);
        // Everything else stays in the inbox as "Other".
        for r in ["author", "subscribed", "ci_activity", "state_change", "manual"] {
            assert_eq!(InboxCategory::from_reason(r), InboxCategory::Other);
        }
    }

    #[test]
    fn notification_gating_needs_response_only() {
        // review/mention/comment ping; assign + other do NOT (they're in the
        // inbox but not worth a desktop banner).
        assert!(InboxCategory::ReviewRequested.is_notifiable());
        assert!(InboxCategory::Mentioned.is_notifiable());
        assert!(InboxCategory::Participating.is_notifiable());
        assert!(!InboxCategory::Assigned.is_notifiable());
        assert!(!InboxCategory::Other.is_notifiable());
    }

    #[test]
    fn is_notifiable_requires_unread() {
        let read = item_from_notification(&notif(
            "review_requested",
            "PullRequest",
            "https://api.github.com/repos/o/r/pulls/1",
            false,
        ))
        .unwrap();
        assert!(!read.is_notifiable(), "read items never ping");
        let unread = item_from_notification(&notif(
            "review_requested",
            "PullRequest",
            "https://api.github.com/repos/o/r/pulls/1",
            true,
        ))
        .unwrap();
        assert!(unread.is_notifiable());
        // An unread assign is in the inbox but not notifiable.
        let assigned = item_from_notification(&notif(
            "assign",
            "Issue",
            "https://api.github.com/repos/o/r/issues/1",
            true,
        ))
        .unwrap();
        assert!(!assigned.is_notifiable());
    }

    #[test]
    fn builds_item_and_repo_parts() {
        let item = item_from_notification(&notif(
            "review_requested",
            "PullRequest",
            "https://api.github.com/repos/safeevac/monorepo/pulls/1490",
            true,
        ))
        .unwrap();
        assert!(item.is_pr);
        assert_eq!(item.issue.number, 1490);
        assert_eq!(item.reason, "review_requested");
        assert_eq!(item.key(), "notif:N1");
        assert_eq!(
            item.repo_parts(),
            Some(("safeevac".into(), "monorepo".into(), 1490))
        );
    }

    #[test]
    fn non_issue_subjects_skipped() {
        assert!(item_from_notification(&notif(
            "mention",
            "Release",
            "https://api.github.com/repos/o/r/releases/1",
            true
        ))
        .is_none());
    }

    #[test]
    fn notification_copy_leads_with_reference() {
        let pr = item_from_notification(&notif(
            "review_requested",
            "PullRequest",
            "https://api.github.com/repos/safeevac/monorepo/pulls/1490",
            true,
        ))
        .unwrap();
        let (title, body) = pr.notification();
        assert_eq!(title, "Review requested");
        assert!(body.starts_with("safeevac/monorepo PR #1490 · "), "{body}");
    }

    #[test]
    fn parses_subject_urls() {
        assert_eq!(
            parse_subject_url("https://api.github.com/repos/o/r/issues/42"),
            Some(("o/r".to_string(), 42, false))
        );
        assert_eq!(
            parse_subject_url("https://api.github.com/repos/o/r/pulls/7"),
            Some(("o/r".to_string(), 7, true))
        );
        assert_eq!(parse_subject_url("garbage"), None);
    }
}
