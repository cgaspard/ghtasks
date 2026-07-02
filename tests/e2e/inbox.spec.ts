import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";
import { INBOX_PAGE_2 } from "./fixtures/mockData";

// The Inbox tab mirrors github.com/notifications. The default scenario seeds 5
// items across reasons (review_requested #92, mention #88, comment #70 [read],
// assign #1371, subscribed #55). The tab badge counts UNREAD (4). The Category
// filter is a multi-select checkbox popover (Review requested / Mentioned /
// Participating / Assigned; empty = All), with a separate "Unread only" toggle.

/** Open the Category filter popover and toggle a category checkbox by label.
 * The popover stays open after a click (multi-select), so this can be chained. */
async function pickCategory(page: Page, label: string) {
  const trigger = page.locator(".filter .trigger");
  const menu = page.locator(".filter .menu");
  if (!(await menu.isVisible())) await trigger.click();
  await page.locator(".filter .opt", { hasText: label }).click();
}

/** Flip the "Unread only" toggle. */
async function toggleUnreadOnly(page: Page) {
  await page.locator(".filter .unread-toggle").click();
}

test.describe("inbox", () => {
  test("tab badge shows the UNREAD count", async ({ mountApp, page }) => {
    await mountApp();
    const tab = page.getByRole("button", { name: /Inbox/ });
    await expect(tab).toBeVisible();
    // 6 items, 5 unread (#70 is read).
    await expect(tab.locator(".await-count")).toHaveText("5");
  });

  test("lists all reasons with quiet reason labels", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();

    // The default "All" filter shows every reason, including subscribed/assigned.
    await expect(page.getByText("Fix the login flow")).toBeVisible();
    await expect(page.getByText("Bump dependencies")).toBeVisible();
    await expect(
      page.getByText("Bug: browser controls missing on facility windows"),
    ).toBeVisible();

    // Reasons render as quiet muted text.
    await expect(page.locator(".reason", { hasText: "review requested" })).toBeVisible();
    await expect(page.locator(".reason", { hasText: "mentioned you" })).toBeVisible();
    await expect(page.locator(".reason", { hasText: "assigned to you" })).toBeVisible();
    await expect(page.locator(".reason", { hasText: "subscribed" })).toBeVisible();

    // No loud dot/pill inside the tab.
    await expect(page.locator(".awaiting-dot")).toHaveCount(0);
    await expect(page.locator(".await-badge")).toHaveCount(0);
  });

  test("shows non-issue notifications (CheckSuite / CI activity) too", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();

    // A CI-activity/CheckSuite notification (no linked issue/PR) still appears
    // — the inbox mirrors github.com/notifications fully.
    const row = page
      .locator("li.issue")
      .filter({ hasText: "CI workflow run failed for main" });
    await expect(row).toBeVisible();
    await expect(row.locator(".reason")).toHaveText("CI activity");
    // Non-addressable → no "#number" is shown (it links to the repo).
    await expect(row.locator(".num")).toHaveCount(0);
  });

  test("Unread only toggle filters to unread items", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();
    await toggleUnreadOnly(page);

    // #70 (read) is hidden; the unread items remain.
    await expect(page.getByText("Split the sync engine into stages")).toHaveCount(0);
    await expect(page.getByText("Fix the login flow")).toBeVisible();

    // Toggling off restores the read item.
    await toggleUnreadOnly(page);
    await expect(
      page.getByText("Split the sync engine into stages"),
    ).toBeVisible();
  });

  test("Assigned category checkbox is its own filter", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();
    await pickCategory(page, "Assigned");
    await expect(
      page.getByText("Bug: browser controls missing on facility windows"),
    ).toBeVisible();
    await expect(page.getByText("Fix the login flow")).toHaveCount(0);
  });

  test("Subscribed & other checkbox isolates the 'other'-category items", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();
    await pickCategory(page, "Subscribed & other");
    // #55 (subscribed) and the CI-activity item are the 'other' category.
    await expect(page.getByText("Bump dependencies")).toBeVisible();
    await expect(page.getByText("CI workflow run failed for main")).toBeVisible();
    // A review_requested item is now excluded.
    await expect(page.getByText("Fix the login flow")).toHaveCount(0);
  });

  test("categories are multi-select and combine (OR) with counts shown", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();
    // Empty selection reads as "All".
    await expect(page.locator(".filter .trigger")).toHaveText(/All/);

    await page.locator(".filter .trigger").click();
    // Per-option counts render.
    await expect(page.locator(".filter .opt-count").first()).toBeVisible();

    // Check two categories — both their items show (OR), not one XOR the other.
    await pickCategory(page, "Review requested");
    await pickCategory(page, "Assigned");
    await expect(page.locator(".filter .trigger")).toHaveText(/2 selected/);
    await expect(page.getByText("Fix the login flow")).toBeVisible(); // review_requested
    await expect(
      page.getByText("Bug: browser controls missing on facility windows"),
    ).toBeVisible(); // assigned
    // The mentioned item (#88) is excluded by the two-category selection.
    await expect(page.getByText("Rework the OAuth callback")).toHaveCount(0);
  });

  test("read items are dimmed but still listed", async ({ mountApp, page }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();
    const readRow = page
      .locator("li.issue")
      .filter({ hasText: "Split the sync engine into stages" });
    await expect(readRow).toHaveClass(/read/);
    const unreadRow = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await expect(unreadRow).not.toHaveClass(/read/);
  });

  test("inline indicator on Issues shows only for needs-response items", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: "Issues", exact: true }).click();

    // #92 is review_requested (needs-response) AND a repo issue → indicator shows.
    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await expect(row).toHaveClass(/awaiting/);
    await expect(row.locator(".awaiting-dot")).toBeVisible();
    await expect(row.locator(".await-badge")).toBeVisible();

    const other = page
      .locator("li.issue")
      .filter({ hasText: "Update the README" });
    await expect(other).not.toHaveClass(/awaiting/);
  });

  test("Mark read updates GitHub, flips the dot, and drops the unread badge — item stays listed", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();

    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await row.getByRole("button", { name: "Mark read" }).click();

    const marked = await page.evaluate(() => {
      const log = (
        window as unknown as {
          __ipcLog: Array<{ cmd: string; args: Record<string, unknown> }>;
        }
      ).__ipcLog;
      return log
        .filter((e) => e.cmd === "mark_notification_read")
        .map((e) => e.args.nodeId);
    });
    expect(marked).toContain("AWAIT_92");

    // The Inbox is a mirror — marking read never removes the row, it just
    // flips its unread state (github.com/notifications keeps read items
    // listed too).
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/read/);
    await expect(row.locator(".unread-dot")).not.toHaveClass(/visible/);
    await expect(row.getByRole("button", { name: "Mark read" })).toHaveCount(0);

    // 5 unread → 4 after marking #92 read.
    const tab = page.getByRole("button", { name: /Inbox/ });
    await expect(tab.locator(".await-count")).toHaveText("4");
  });

  test("empty inbox → badge hidden + friendly empty state", async ({
    mountApp,
    page,
  }) => {
    await mountApp({ inbox: [] });
    const tab = page.getByRole("button", { name: /Inbox/ });
    await expect(tab.locator(".await-count")).toHaveCount(0);
    await tab.click();
    await expect(page.getByText(/inbox zero/i)).toBeVisible();
  });

  test("unread rows show a dot, read rows don't", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();

    const unreadRow = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await expect(unreadRow.locator(".unread-dot")).toHaveClass(/visible/);

    const readRow = page
      .locator("li.issue")
      .filter({ hasText: "Split the sync engine into stages" });
    await expect(readRow.locator(".unread-dot")).not.toHaveClass(/visible/);
  });

  test("search filters loaded items by title, repo, and reason", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();

    const search = page.getByPlaceholder("Search loaded items…");
    await search.fill("login");
    await expect(page.getByText("Fix the login flow")).toBeVisible();
    await expect(page.getByText("Bump dependencies")).toHaveCount(0);

    // Matches by reason label too.
    await search.fill("subscribed");
    await expect(page.getByText("Bump dependencies")).toBeVisible();
    await expect(page.getByText("Fix the login flow")).toHaveCount(0);

    // Clear button resets.
    await page.locator(".search-clear").click();
    await expect(search).toHaveValue("");
    await expect(page.getByText("Fix the login flow")).toBeVisible();
  });

  test("the infinite-scroll sentinel loads the next page and appends items", async ({
    mountApp,
    page,
  }) => {
    // In this headless viewport the short fixture list already fits on
    // screen, so the sentinel intersects (and page 2 loads) as soon as the
    // tab mounts — the same "load more" path a real scroll would trigger,
    // just without needing to scroll. Assert on the outcome (item appended,
    // page-2 fetch happened) rather than a pre-load absence that's racy here.
    await mountApp({ inboxHasMore: true, inboxPages: [INBOX_PAGE_2] });
    await page.getByRole("button", { name: /Inbox/ }).click();

    await expect(
      page.getByText("Archive the legacy webhook handler"),
    ).toBeVisible();

    const fetchedPages = await page.evaluate(() => {
      const log = (
        window as unknown as {
          __ipcLog: Array<{ cmd: string; args: Record<string, unknown> }>;
        }
      ).__ipcLog;
      return log.filter((e) => e.cmd === "fetch_inbox").map((e) => e.args.page);
    });
    expect(fetchedPages).toContain(2);
  });

  test("a manual refresh re-fetches page 1 (not a continuation of scrolled-in pages)", async ({
    mountApp,
    page,
  }) => {
    await mountApp({ inboxHasMore: true, inboxPages: [INBOX_PAGE_2] });
    await page.getByRole("button", { name: /Inbox/ }).click();
    await expect(
      page.getByText("Archive the legacy webhook handler"),
    ).toBeVisible();

    await page.getByRole("button", { name: /Refresh/i }).click();
    await expect(page.getByText("Fix the login flow")).toBeVisible();

    // Refresh always asks for page 1 again (replace semantics), regardless of
    // how far the user had scrolled — it never resumes from the last-loaded
    // page.
    const fetchedPages = await page.evaluate(() => {
      const log = (
        window as unknown as {
          __ipcLog: Array<{ cmd: string; args: Record<string, unknown> }>;
        }
      ).__ipcLog;
      return log.filter((e) => e.cmd === "fetch_inbox").map((e) => e.args.page);
    });
    expect(fetchedPages.filter((p) => p === 1).length).toBeGreaterThanOrEqual(2);
  });
});
