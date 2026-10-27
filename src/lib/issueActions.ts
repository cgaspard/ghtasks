import { get } from "svelte/store";
import { api, type Issue } from "./api";
import {
  auth,
  inbox,
  projectResults,
  recentlyClosed,
  recentlyCreated,
  sourceResults,
} from "./stores";

export async function closeIssue(repo: string, issue: Issue): Promise<Issue> {
  const account = get(auth).user?.login;
  const result = await api.toggleIssueState(repo, issue.number, true);
  if (result.state !== "closed") {
    throw new Error("GitHub did not confirm that the issue was closed.");
  }
  const closed = { ...issue, state: result.state, updated_at: result.updated_at ?? new Date().toISOString() };
  const currentAuth = get(auth);
  if (!currentAuth.authenticated || currentAuth.user?.login !== account) return closed;

  const canonicalUrl = (url: string) => url.replace(/\/$/, "").toLowerCase();
  const targetUrl = canonicalUrl(issue.html_url);
  const matches = (other: Issue) => other.node_id === issue.node_id || (targetUrl !== "" && canonicalUrl(other.html_url) === targetUrl);
  const updateState = (other: Issue): Issue => ({ ...other, state: closed.state, updated_at: closed.updated_at });

  recentlyClosed.update((entries) => new Map(entries).set(issue.node_id, Date.now()));
  recentlyCreated.update((entries) => new Map([...entries].map(([id, entry]) => [id,
    matches(entry.issue) ? { ...entry, issue: updateState(entry.issue), item: entry.item ? { ...entry.item, issue: updateState(entry.item.issue) } : undefined } : entry,
  ])));
  projectResults.update((results) => results.map((result) => result.snapshot ? {
    ...result,
    snapshot: { ...result.snapshot, items: result.snapshot.items.map((item) => matches(item.issue) ? { ...item, issue: updateState(item.issue) } : item) },
  } : result));
  sourceResults.update((results) => results.map((result) => ({ ...result, issues: result.issues.filter((other) => !matches(other)) })));
  inbox.update((items) => items.map((item) => matches(item.issue) ? { ...item, issue: updateState(item.issue), is_open: false } : item));
  return closed;
}
