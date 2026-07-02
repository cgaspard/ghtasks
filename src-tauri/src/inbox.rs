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
    /// True if the subject is a concrete Issue/PR (so it has a number, links to
    /// the item, and can be open-state-checked). False for CheckSuite / Release
    /// / Discussion / subject-less notifications, which link to the repo.
    pub addressable: bool,
    /// GitHub notification thread id (for mark-read sync).
    pub thread_id: String,
    /// Whether the notification is unread (drives the unread badge + styling).
    pub unread: bool,
    /// ISO-8601 timestamp the thread was last updated.
    pub event_at: String,
    /// Open/closed/merged state of the underlying issue/PR, when known (only
    /// resolved for `addressable` items). `None` when unresolved (non-
    /// addressable, or the state lookup failed/omitted this item) — treated
    /// as "assume open" everywhere state matters, since GitHub itself never
    /// hides a notification just because its issue/PR later closed.
    #[serde(default)]
    pub is_open: Option<bool>,
}

impl InboxItem {
    pub fn key(&self) -> &str {
        &self.issue.node_id
    }

    /// Whether this item should raise a desktop notification: it must be
    /// unread, not a closed/merged issue or PR (GitHub still lists those in
    /// the inbox, but pinging about something already resolved is noise),
    /// and either a needs-response category OR a CI-activity update (per user
    /// preference — build failures/completions ping). Other noisy reasons
    /// (subscribed / author / state_change / manual) do not ping.
    pub fn is_notifiable(&self) -> bool {
        if !self.unread || self.is_open == Some(false) {
            return false;
        }
        self.category.is_notifiable() || self.reason == "ci_activity"
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
        let heading = match self.category {
            InboxCategory::ReviewRequested => "Review requested",
            InboxCategory::Mentioned => "You were mentioned",
            InboxCategory::Participating => "New reply",
            InboxCategory::Assigned => "Assigned to you",
            InboxCategory::Other if self.reason == "ci_activity" => "CI activity",
            InboxCategory::Other => "GitHub notification",
        };
        // Addressable items lead with "repo PR/issue #N"; subject-less ones
        // (CI runs, releases, …) just lead with the repo.
        let reference = if self.addressable {
            let kind = if self.is_pr { "PR" } else { "issue" };
            format!("{repo} {kind} #{n}")
        } else {
            repo.to_string()
        };
        let body = format!("{reference} · {title} — open GH Tasks to view");
        (heading.to_string(), body)
    }

    /// `(owner, name, number)` for the state-lookup query — only for concrete
    /// Issue/PR items. Non-addressable items (CheckSuite/Release/…) have no
    /// number to check, so they're skipped by the open-state filter.
    fn repo_parts(&self) -> Option<(String, String, u64)> {
        if !self.addressable {
            return None;
        }
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

/// Build an `InboxItem` from any notification — mirrors github.com/notifications
/// fully (Issues, PRs, CheckSuites, Releases, Discussions, …). Items whose
/// subject is a real Issue/PR get a link to it and are eligible for the
/// open-state filter; everything else links to the repo and is `addressable:
/// false` (we can't GraphQL-check its state).
fn item_from_notification(n: &Notification) -> Option<InboxItem> {
    let repo = n.repository.full_name.clone();
    let (owner, name) = repo.split_once('/')?;

    // Try to resolve a concrete Issue/PR from the subject.
    let issue_pr = if n.subject.subject_type == "Issue"
        || n.subject.subject_type == "PullRequest"
    {
        n.subject
            .url
            .as_deref()
            .and_then(parse_subject_url)
            .map(|(_repo, number, is_pr)| (number, is_pr))
    } else {
        None
    };

    let (number, is_pr, html_url, addressable) = match issue_pr {
        Some((number, is_pr)) => {
            let path = if is_pr { "pull" } else { "issues" };
            (
                number,
                is_pr,
                format!("https://github.com/{owner}/{name}/{path}/{number}"),
                true,
            )
        }
        // CheckSuite / Release / Discussion / subject-less → link to the repo.
        None => (
            0,
            false,
            format!("https://github.com/{owner}/{name}"),
            false,
        ),
    };

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
        addressable,
        thread_id: n.id.clone(),
        unread: n.unread,
        event_at: n.updated_at.clone(),
        reason: n.reason.clone(),
        issue,
        is_open: None,
    })
}

/// One page of the inbox, plus whether GitHub has more notifications beyond it
/// (drives the frontend's infinite-scroll "load more").
pub struct InboxPage {
    pub items: Vec<InboxItem>,
    pub has_more: bool,
}

/// Fetch one page (1-indexed, 50 GitHub notifications each) of the user's
/// inbox — read AND unread threads (mirroring github.com/notifications).
/// Closed/merged issues and PRs stay in the list — GitHub's own inbox keeps a
/// notification visible after its subject closes or merges, it doesn't drop
/// it — but each item's resolved open/closed state is attached via a batched
/// GraphQL check so notification-gating can still skip pinging about
/// already-resolved items. Items stay in GitHub's own newest-first order
/// within this page — unread state is a display cue, not a sort key,
/// matching github.com/notifications.
pub async fn fetch_inbox_page(
    client: &reqwest::Client,
    token: &str,
    page: u32,
) -> Result<InboxPage> {
    // `participating=false` to match the full inbox rather than only threads
    // you're directly in — `list_notifications` already passes `all=true` so
    // read items are included too.
    let fetched = crate::github::list_notifications(client, token, false, page).await?;

    let candidates: Vec<InboxItem> = fetched
        .items
        .iter()
        .filter_map(item_from_notification)
        .collect();

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

    let mut items: Vec<InboxItem> = candidates
        .into_iter()
        .map(|mut item| {
            if let Some((owner, name, number)) = item.repo_parts() {
                if let Some(state) = states.get(&format!("{owner}/{name}#{number}")) {
                    item.is_open = Some(state == "open");
                }
            }
            item
        })
        .collect();
    // Preserve GitHub's own newest-first order (matches github.com/notifications).
    // Unread state is a visual cue (dot/bold), not a position override — sorting
    // unread-first here would float an old-but-unread item above a newer-but-read
    // one, which is not how github.com/notifications renders the list.
    items.sort_by(|a, b| b.event_at.cmp(&a.event_at));
    Ok(InboxPage {
        items,
        has_more: fetched.has_more,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notif(reason: &str, subject_type: &str, url: &str, unread: bool) -> Notification {
        notif_opt(reason, subject_type, Some(url), unread)
    }

    fn notif_opt(
        reason: &str,
        subject_type: &str,
        url: Option<&str>,
        unread: bool,
    ) -> Notification {
        use crate::github::{NotificationRepo, NotificationSubject};
        Notification {
            id: "N1".into(),
            reason: reason.into(),
            unread,
            updated_at: "2026-06-25T09:00:00Z".into(),
            subject: NotificationSubject {
                title: "T".into(),
                url: url.map(|u| u.into()),
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

        // CI activity DOES ping (user preference), even though its category is
        // Other and it's not addressable.
        let ci = item_from_notification(&notif_opt(
            "ci_activity",
            "CheckSuite",
            None,
            true,
        ))
        .unwrap();
        assert!(ci.is_notifiable(), "ci_activity should ping");

        // But other Other-category reasons (subscribed) do NOT ping.
        let sub = item_from_notification(&notif(
            "subscribed",
            "PullRequest",
            "https://api.github.com/repos/o/r/pulls/1",
            true,
        ))
        .unwrap();
        assert!(!sub.is_notifiable());
    }

    #[test]
    fn closed_or_merged_items_are_not_notifiable_but_stay_addressable() {
        // A closed/merged PR must not ping (already-resolved is noise) but must
        // still be a normal, addressable, visible inbox item — GitHub's own
        // inbox keeps notifications for closed/merged subjects, it just doesn't
        // re-ping about them (regression: v0.4.x briefly dropped these from the
        // list entirely, which disagreed with github.com/notifications).
        let mut merged = item_from_notification(&notif(
            "mention",
            "PullRequest",
            "https://api.github.com/repos/o/r/pulls/1",
            true,
        ))
        .unwrap();
        assert!(merged.is_notifiable(), "open + unread + mention pings");
        merged.is_open = Some(false);
        assert!(!merged.is_notifiable(), "closed/merged must not ping");
        assert!(merged.addressable, "still addressable/visible in the list");

        // Unknown state (is_open: None — lookup skipped or failed) must not
        // block notification; fail-open, matching the rest of the state-check
        // plumbing.
        let unknown = item_from_notification(&notif(
            "mention",
            "PullRequest",
            "https://api.github.com/repos/o/r/pulls/2",
            true,
        ))
        .unwrap();
        assert_eq!(unknown.is_open, None);
        assert!(unknown.is_notifiable(), "unknown state defaults to notifiable");
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
        assert!(item.addressable);
        assert_eq!(item.issue.number, 1490);
        assert_eq!(item.reason, "review_requested");
        assert_eq!(item.key(), "notif:N1");
        assert_eq!(
            item.repo_parts(),
            Some(("safeevac".into(), "monorepo".into(), 1490))
        );
    }

    #[test]
    fn non_issue_subjects_are_shown_but_not_addressable() {
        // A CheckSuite / CI notification (null subject url) still appears in the
        // inbox — it links to the repo and is not open-state-checked.
        let ci = item_from_notification(&notif_opt(
            "ci_activity",
            "CheckSuite",
            None,
            true,
        ))
        .expect("CheckSuite items are now shown");
        assert!(!ci.addressable);
        assert_eq!(ci.issue.number, 0);
        assert_eq!(ci.issue.html_url, "https://github.com/safeevac/monorepo");
        assert!(ci.repo_parts().is_none(), "non-addressable → skipped by state filter");

        // A Release is likewise shown (links to the repo).
        let rel = item_from_notification(&notif(
            "subscribed",
            "Release",
            "https://api.github.com/repos/safeevac/monorepo/releases/1",
            true,
        ))
        .expect("Release items are shown");
        assert!(!rel.addressable);
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
