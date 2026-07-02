import { test, expect } from "./fixtures/app";

// The Inbox tab mirrors github.com/notifications. The default scenario seeds 5
// items across reasons (review_requested #92, mention #88, comment #70 [read],
// assign #1371, subscribed #55). The tab badge counts UNREAD (4). Chips mirror
// GitHub's inbox filters (All / Unread / Review requested / Mentioned /
// Participating / Assigned).

test.describe("inbox", () => {
  test("tab badge shows the UNREAD count", async ({ mountApp, page }) => {
    await mountApp();
    const tab = page.getByRole("button", { name: /Inbox/ });
    await expect(tab).toBeVisible();
    // 5 items, 4 unread (#70 is read).
    await expect(tab.locator(".await-count")).toHaveText("4");
  });

  test("lists all reasons with quiet reason labels + chips", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();

    // The "All" chip shows every reason, including subscribed/assigned.
    await expect(page.getByText("Fix the login flow")).toBeVisible();
    await expect(page.getByText("Bump dependencies")).toBeVisible();
    await expect(
      page.getByText("Bug: browser controls missing on facility windows"),
    ).toBeVisible();

    // Reasons render as quiet muted text (scoped to .reason to avoid matching
    // the identically-named chips).
    await expect(page.locator(".reason", { hasText: "review requested" })).toBeVisible();
    await expect(page.locator(".reason", { hasText: "mentioned you" })).toBeVisible();
    await expect(page.locator(".reason", { hasText: "assigned to you" })).toBeVisible();
    await expect(page.locator(".reason", { hasText: "subscribed" })).toBeVisible();

    // No loud dot/pill inside the tab.
    await expect(page.locator(".awaiting-dot")).toHaveCount(0);
    await expect(page.locator(".await-badge")).toHaveCount(0);
  });

  test("Unread chip filters to unread only", async ({ mountApp, page }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();
    await page.locator(".chip", { hasText: "Unread" }).click();

    // #70 (read) is hidden; the 4 unread remain.
    await expect(page.getByText("Split the sync engine into stages")).toHaveCount(0);
    await expect(page.getByText("Fix the login flow")).toBeVisible();
  });

  test("Assigned chip is its own filter", async ({ mountApp, page }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();
    await page.locator(".chip", { hasText: "Assigned" }).click();
    await expect(
      page.getByText("Bug: browser controls missing on facility windows"),
    ).toBeVisible();
    await expect(page.getByText("Fix the login flow")).toHaveCount(0);
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

  test("Done clears an item + drops the unread badge", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: /Inbox/ }).click();

    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await row.getByRole("button", { name: "Mark done" }).click();

    const marked = await page.evaluate(() => {
      const log = (
        window as unknown as {
          __ipcLog: Array<{ cmd: string; args: Record<string, unknown> }>;
        }
      ).__ipcLog;
      return log
        .filter((e) => e.cmd === "mark_inbox_seen")
        .map((e) => e.args.nodeId);
    });
    expect(marked).toContain("AWAIT_92");

    await expect(row).toHaveCount(0);
    // 4 unread → 3 after clearing #92.
    const tab = page.getByRole("button", { name: /Inbox/ });
    await expect(tab.locator(".await-count")).toHaveText("3");
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
});
