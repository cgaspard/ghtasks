import type { Page } from "@playwright/test";
import type { Issue, ProjectFetchResult } from "../../src/lib/api";
import { test, expect } from "./fixtures/app";
import { makeIssue, PROJECT_ITEMS, PROJECT_PAGE_EVENT, REPO_ISSUES, SOURCE_RESULTS } from "./fixtures/mockData";

test.use({ viewport: { width: 480, height: 560 } });

const issue: Issue = { ...REPO_ISSUES[0], body: "Finish the login work and keep the project status independent." };
const scenario = {
  issueDetail: { issue, comments: [] },
  sourceResults: SOURCE_RESULTS.map((source) => ({ ...source, issues: source.issues.map((item) => item.number === issue.number ? issue : item) })),
  projectPages: [{ ...PROJECT_PAGE_EVENT, items: PROJECT_ITEMS.map((item) => item.issue.number === issue.number ? { ...item, issue: { ...item.issue, node_id: issue.node_id } } : item) }],
};

async function openTodo(page: Page) {
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await page.locator("li.issue").filter({ hasText: issue.title }).getByRole("button", { name: issue.title, exact: true }).click();
  const detail = page.locator(".pane.detail");
  await expect(detail.getByRole("heading", { name: new RegExp(issue.title) })).toBeVisible();
  return detail;
}

async function closeCalls(page: Page) {
  return page.evaluate(() => (window as unknown as { __ipcLog: Array<{ cmd: string; args: unknown }> }).__ipcLog.filter((call) => call.cmd === "toggle_issue_state"));
}

test("Todo detail exposes Close issue and cancellation preserves the comment draft", async ({ mountApp, page }) => {
  await mountApp(scenario);
  const detail = await openTodo(page);
  const close = detail.getByRole("button", { name: "Close issue", exact: true });
  const comment = detail.getByPlaceholder("Write a comment…");
  await expect(close).toBeInViewport();
  await comment.fill("Keep this unfinished reply.");
  await close.click();
  const confirmation = detail.getByRole("group", { name: "Confirm closing issue", exact: true });
  await expect(confirmation).toContainText(/project status/i);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(close).toBeFocused();
  await expect(comment).toHaveValue("Keep this unfinished reply.");
  await close.click();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(close).toBeFocused();
  await expect(comment).toHaveValue("Keep this unfinished reply.");
  expect(await closeCalls(page)).toHaveLength(0);
  await expect(detail.getByRole("heading", { name: new RegExp(issue.title) })).toBeVisible();
});

test("closing detail updates Todos and cached issue state while preserving project status and PRs", async ({ mountApp, page }) => {
  await mountApp({ ...scenario, toggledIssue: { ...issue, state: "closed", updated_at: "2026-10-26T21:00:00Z", linked_prs: [], milestone: null } });
  const detail = await openTodo(page);
  await detail.getByRole("button", { name: "Close issue", exact: true }).click();
  await detail.getByRole("group", { name: "Confirm closing issue", exact: true }).getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(detail.getByRole("status")).toHaveText("Issue closed on GitHub.");
  await expect(detail.locator(".state")).toHaveText("Closed");
  await expect(detail.getByRole("button", { name: "Close issue", exact: true })).toHaveCount(0);
  expect(await closeCalls(page)).toEqual([{ cmd: "toggle_issue_state", args: { repo: "octocat/hello-world", number: 92, closed: true } }]);
  const cached = await page.evaluate(() => {
    const projects: ProjectFetchResult[] = JSON.parse(localStorage.getItem("ghtasks.projectResults")!);
    return projects[0].snapshot!.items.find((item) => item.issue.number === 92)!;
  });
  expect(cached.issue.state).toBe("closed");
  expect(cached.field_values).toEqual(PROJECT_ITEMS[0].field_values);
  expect(cached.issue.linked_prs).toEqual(PROJECT_ITEMS[0].issue.linked_prs);
  expect(cached.issue.milestone).toEqual(PROJECT_ITEMS[0].issue.milestone);
  const inboxIssueState = await page.evaluate(() => JSON.parse(localStorage.getItem("ghtasks.inbox")!).find((item: { issue: Issue }) => item.issue.number === 92).issue.state);
  expect(inboxIssueState).toBe("closed");
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("li.issue").filter({ hasText: issue.title })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  await expect(page.locator("li.issue").filter({ hasText: issue.title })).toHaveCount(0);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const project = page.locator("li.issue").filter({ hasText: issue.title });
  await expect(project.getByText("In Progress", { exact: true })).toBeVisible();
  await expect(project.getByRole("button", { name: "PR #410", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __ipcLog: Array<{ cmd: string }> }).__ipcLog.filter((call) => call.cmd === "set_project_item_status"))).toHaveLength(0);
});

test("a failed detail close retains the issue and draft and can be retried", async ({ mountApp, page }) => {
  await mountApp({ ...scenario, errors: { toggle_issue_state: "GitHub is unavailable" } });
  const detail = await openTodo(page);
  await detail.getByPlaceholder("Write a comment…").fill("Reply after this succeeds.");
  await detail.getByRole("button", { name: "Close issue", exact: true }).click();
  const confirmation = detail.getByRole("group", { name: "Confirm closing issue", exact: true });
  await confirmation.getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(confirmation.getByRole("alert")).toContainText("GitHub is unavailable");
  await expect(detail.locator(".state")).toHaveText("Open");
  await expect(detail.getByPlaceholder("Write a comment…")).toHaveValue("Reply after this succeeds.");
  const sourceStillContainsIssue = await page.evaluate(() => JSON.parse(localStorage.getItem("ghtasks.sourceResults")!).some((source: { issues: Issue[] }) => source.issues.some((item) => item.number === 92)));
  expect(sourceStillContainsIssue).toBe(true);
  await page.evaluate(() => { (window as unknown as { __SCENARIO__: { errors: Record<string, string> } }).__SCENARIO__.errors = {}; });
  await confirmation.getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(detail.getByRole("status")).toHaveText("Issue closed on GitHub.");
  await expect(detail.getByPlaceholder("Write a comment…")).toHaveValue("Reply after this succeeds.");
  expect(await closeCalls(page)).toHaveLength(2);
});

for (const [name, issuePatch] of [
  ["closed issue", { state: "closed" }],
  ["pull request", { pull_request: { url: "https://api.github.com/repos/octocat/hello-world/pulls/92" }, html_url: "https://github.com/octocat/hello-world/pull/92" }],
  ["pull request identified by URL", { pull_request: null, html_url: "https://github.com/octocat/hello-world/pull/92" }],
] as const) {
  test(`detail does not offer Close issue for a ${name}`, async ({ mountApp, page }) => {
    await mountApp({ ...scenario, issueDetail: { issue: { ...issue, ...issuePatch }, comments: [] } });
    const detail = await openTodo(page);
    await expect(detail.getByRole("button", { name: "Close issue", exact: true })).toHaveCount(0);
    expect(await closeCalls(page)).toHaveLength(0);
  });
}

test("pending detail close prevents duplicate requests, refresh and accidental Back", async ({ mountApp, page }) => {
  await mountApp(scenario);
  const detail = await openTodo(page);
  await detail.getByPlaceholder("Write a comment…").fill("Retain this while closing.");
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<unknown> };
      __closeCount: number;
      __completeClose: () => void;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__closeCount = 0;
    w.__TAURI_INTERNALS__.invoke = (command, args) => {
      if (command !== "toggle_issue_state") return invoke(command, args);
      w.__closeCount++;
      return new Promise((resolve) => { w.__completeClose = () => { void invoke(command, args).then(resolve); }; });
    };
  });
  await detail.getByRole("button", { name: "Close issue", exact: true }).click();
  const confirmation = detail.getByRole("group", { name: "Confirm closing issue", exact: true });
  await confirmation.getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(confirmation.getByRole("button", { name: "Closing…", exact: true })).toBeDisabled();
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(detail.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
  await expect(detail.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await expect(detail.getByRole("button", { name: "Comment", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __closeCount: number }).__closeCount)).toBe(1);
  await page.evaluate(() => (window as unknown as { __completeClose: () => void }).__completeClose());
  await expect(detail.getByRole("status")).toHaveText("Issue closed on GitHub.");
  await expect(detail.getByPlaceholder("Write a comment…")).toHaveValue("Retain this while closing.");
});

test("a different detail route loads its own issue and ignores the previous issue's late response", async ({ mountApp, page }) => {
  await mountApp(scenario);
  const detail = await openTodo(page);
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args: { number?: number }) => Promise<unknown> };
      __completeOldDetail: () => void;
      __oldDetailResolved: boolean;
    };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__oldDetailResolved = false;
    w.__TAURI_INTERNALS__.invoke = (command, args) => {
      if (command !== "get_issue_detail" || args.number !== 92) return invoke(command, args);
      const oldResponse = invoke(command, args);
      return new Promise((resolve) => { w.__completeOldDetail = () => { void oldResponse.then((response) => { resolve(response); w.__oldDetailResolved = true; }); }; });
    };
  });
  await detail.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(detail.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  const nextIssue = makeIssue({ number: 501, node_id: "NEW_REPO_501", title: "A newly created issue in another repository", repository_url: "https://api.github.com/repos/octocat/new-repo", html_url: "https://github.com/octocat/new-repo/issues/501" });
  await page.evaluate(async (next) => {
    const modulePath = "/src/lib/stores.ts";
    const { createdIssueNotice } = await import(modulePath);
    (window as unknown as { __SCENARIO__: { issueDetail: unknown } }).__SCENARIO__.issueDetail = { issue: next, comments: [] };
    createdIssueNotice.set({ repo: "octocat/new-repo", issue: next });
  }, nextIssue);
  await page.locator(".created-notice").getByRole("button", { name: "View issue", exact: true }).click();
  await expect(detail.getByRole("heading", { name: new RegExp(nextIssue.title) })).toBeVisible();
  await page.evaluate(() => (window as unknown as { __completeOldDetail: () => void }).__completeOldDetail());
  await expect.poll(() => page.evaluate(() => (window as unknown as { __oldDetailResolved: boolean }).__oldDetailResolved)).toBe(true);
  await expect(detail.getByRole("heading", { name: new RegExp(nextIssue.title) })).toBeVisible();
  await expect(detail.getByRole("heading", { name: new RegExp(issue.title) })).toHaveCount(0);
  await detail.getByRole("button", { name: "Close issue", exact: true }).click();
  await detail.getByRole("group", { name: "Confirm closing issue", exact: true }).getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(detail.getByRole("status")).toHaveText("Issue closed on GitHub.");
  expect(await closeCalls(page)).toEqual([{ cmd: "toggle_issue_state", args: { repo: "octocat/new-repo", number: 501, closed: true } }]);
  await detail.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("li.issue").filter({ hasText: issue.title })).toBeVisible();
});
