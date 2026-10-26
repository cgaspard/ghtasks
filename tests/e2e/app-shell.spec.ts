import { test, expect } from "./fixtures/app";
import { PROJECT_ITEMS, PROJECT_PAGE_EVENT } from "./fixtures/mockData";

test.describe("Application shell", () => {
  test.use({ viewport: { width: 480, height: 560 } });

  test("sync controls stay below the scrolling list and refresh the actual data commands", async ({ mountApp, page }) => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      ...PROJECT_ITEMS[index % PROJECT_ITEMS.length],
      item_id: `SHELL_ITEM_${index}`,
      issue: {
        ...PROJECT_ITEMS[index % PROJECT_ITEMS.length].issue,
        node_id: `SHELL_ISSUE_${index}`,
        title: `Task ${index + 1}`,
      },
    }));
    await mountApp({ projectPages: [{ ...PROJECT_PAGE_EVENT, items }] });
    const header = page.locator("header.bar");
    const footer = page.locator('footer[aria-label="Sync controls"]');
    await expect(footer.getByRole("status")).toContainText("Synced just now");
    await expect(header.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
    await expect(header).not.toContainText(/synced/i);

    const commandCounts = () => page.evaluate(() => {
      const calls = (window as unknown as { __ipcLog: Array<{ cmd: string }> }).__ipcLog;
      return ["fetch_all", "fetch_all_projects_streaming", "fetch_inbox"].map((cmd) => calls.filter((call) => call.cmd === cmd).length);
    });
    const before = await commandCounts();
    await footer.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect.poll(commandCounts).toEqual(before.map((count) => count + 1));
    await expect(footer.getByRole("status")).toContainText("Synced just now");

    const list = page.locator("ul.issues");
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    const originalFooter = await footer.boundingBox();
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(page.locator("li.issue").last()).toBeInViewport();
    const scrolledFooter = await footer.boundingBox();
    expect(scrolledFooter!.y).toBe(originalFooter!.y);
    expect(scrolledFooter!.y + scrolledFooter!.height).toBeCloseTo(560, 0);
    const listBounds = await list.boundingBox();
    expect(listBounds!.y + listBounds!.height).toBeLessThanOrEqual(scrolledFooter!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(480);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(560);
  });

  test("Inbox reports its own failed sync and recovers through the footer", async ({ mountApp, page }) => {
    await mountApp({ errors: { fetch_inbox: "Notifications unavailable" } });
    const footer = page.locator('footer[aria-label="Sync controls"]');
    await expect(footer.getByRole("status")).toHaveText("Synced just now");
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(footer.getByRole("status")).toHaveText("Sync needs attention");
    await expect(page.getByRole("alert")).toContainText("Notifications unavailable");

    await page.evaluate(() => {
      (window as unknown as { __SCENARIO__: { errors: Record<string, string> } }).__SCENARIO__.errors = {};
    });
    await footer.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(footer.getByRole("status")).toHaveText("Synced just now");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("Settings uses one contextual footer and distinguishes connection saves", async ({ mountApp, page }) => {
    await mountApp();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.locator("footer:visible")).toHaveCount(1);
    await expect(page.locator("footer:visible")).toHaveText("Preferences save automatically");
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: /Projects & repositories Choose/ }).click();
    await page.getByRole("button", { name: "+ Add connection", exact: true }).click();
    await expect(page.locator("footer:visible")).toHaveCount(1);
    await expect(page.locator("footer:visible")).toHaveText("Connection changes apply when you save.");
    const footerBounds = await page.locator("footer:visible").boundingBox();
    expect(footerBounds!.y + footerBounds!.height).toBeCloseTo(560, 0);
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
  });

  test("main tab selection clears in detail and returns when navigating to a list", async ({ mountApp, page }) => {
    await mountApp();
    await expect(page.locator('footer[aria-label="Sync controls"]')).toContainText("Synced just now");
    const projects = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Projects", exact: true });
    await expect(projects).toHaveClass(/active/);
    await page.locator("li.issue").filter({ hasText: "Fix the login flow" }).getByRole("button", { name: "View issue", exact: true }).click();
    await expect(page.getByText(/login button does/i)).toBeVisible();
    await expect(projects).toHaveAttribute("aria-pressed", "false");
    await expect(projects).not.toHaveClass(/active/);
    await expect(page.locator('footer[aria-label="Sync controls"]')).toBeVisible();
    await projects.click();
    await expect(projects).toHaveAttribute("aria-pressed", "true");
    await expect(projects).toHaveClass(/active/);
    await expect(page.locator("li.issue").filter({ hasText: "Fix the login flow" })).toBeVisible();
  });
});
