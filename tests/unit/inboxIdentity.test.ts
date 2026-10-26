import { beforeEach, expect, test } from "vitest";
import { get } from "svelte/store";
import { inbox, inboxByKey, projectResults, sourceResults, seenInboxCues } from "../../src/lib/stores";
import { INBOX_ITEMS, makeIssue, PROJECT_PAGE_EVENT } from "../e2e/fixtures/mockData";

beforeEach(() => {
  inbox.set([]);
  sourceResults.set([]);
  projectResults.set([]);
  seenInboxCues.set({});
});

test("associates GitHub notification thread identity with the real issue for read mutations", () => {
  const issue = makeIssue({ node_id: "ISSUE_REAL", html_url: "https://github.com/Octocat/hello-world/issues/42", number: 42 });
  const notification = { ...INBOX_ITEMS[0], thread_id: "99", issue: { ...issue, node_id: "notif:99", html_url: "https://github.com/octocat/hello-world/issues/42/" } };
  inbox.set([notification]);
  sourceResults.set([{ source_id: "repo", error: null, issues: [issue] }]);
  expect(get(inboxByKey).get("ISSUE_REAL")?.issue.node_id).toBe("notif:99");
  expect(get(inboxByKey).get("notif:99")?.thread_id).toBe("99");
});

test("associates a project-only issue without confusing a same-number issue in another repo", () => {
  const issue = makeIssue({ node_id: "PROJECT_REAL", html_url: "https://github.com/octocat/hello-world/issues/42", number: 42 });
  const notification = { ...INBOX_ITEMS[0], issue: { ...issue, node_id: "notif:101" } };
  inbox.set([notification]);
  const page = PROJECT_PAGE_EVENT;
  projectResults.set([{ source_id: page.source_id, error: null, snapshot: { project: page.project, fields: page.fields, items: [{ ...page.items[0], issue }] } }]);
  const other = makeIssue({ node_id: "OTHER_REPO", html_url: "https://github.com/octocat/another/issues/42", number: 42 });
  sourceResults.set([{ source_id: "other", error: null, issues: [other] }]);
  expect(get(inboxByKey).get("PROJECT_REAL")).toEqual(notification);
  expect(get(inboxByKey).has("OTHER_REPO")).toBe(false);
});

test("removes issue aliases when their notification is no longer in the inbox", () => {
  const issue = makeIssue({ node_id: "ISSUE_REAL" });
  sourceResults.set([{ source_id: "repo", error: null, issues: [issue] }]);
  inbox.set([{ ...INBOX_ITEMS[0], issue: { ...issue, node_id: "notif:99" } }]);
  expect(get(inboxByKey).has("ISSUE_REAL")).toBe(true);
  inbox.set([]);
  expect(get(inboxByKey).has("ISSUE_REAL")).toBe(false);
});

test("dismisses an attention cue without removing its unread notification from Inbox", () => {
  const issue = makeIssue({ node_id: "ISSUE_REAL" });
  const notification = { ...INBOX_ITEMS[0], unread: true, event_at: "2026-10-26T10:00:00Z", issue: { ...issue, node_id: "notif:99" } };
  sourceResults.set([{ source_id: "repo", error: null, issues: [issue] }]);
  inbox.set([notification]);
  seenInboxCues.set({ "notif:99": notification.event_at });
  expect(get(inboxByKey).has("ISSUE_REAL")).toBe(false);
  expect(get(inbox)).toHaveLength(1);
  inbox.set([{ ...notification, event_at: "2026-10-26T11:00:00Z" }]);
  expect(get(inboxByKey).has("ISSUE_REAL")).toBe(true);
  inbox.set([{ ...notification, unread: false }]);
  expect(get(inboxByKey).has("ISSUE_REAL")).toBe(false);
});
