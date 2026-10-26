import { test, expect } from "./fixtures/app";

test.use({ viewport: { width: 480, height: 560 } });

test("Todos and Inbox remember their own Compact layout", async ({ mountApp, page }) => {
  await mountApp();
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await page.getByRole("button", { name: "Compact", exact: true }).click();
  await expect(page.locator("ul.issues")).toHaveAttribute("data-card-view", "short");
  await expect(page.locator("li.issue").first().locator(".row2")).toBeHidden();
  await page.getByRole("button", { name: /Inbox/ }).click();
  await expect(page.locator("ul.issues")).toHaveAttribute("data-card-view", "tall");
  await page.getByRole("button", { name: "Compact", exact: true }).click();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expanded", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await page.reload();
  await expect(page.locator("ul.issues")).toHaveAttribute("data-card-view", "short");
  const overflow = await page.locator("li.issue").first().evaluate((row) => {
    const title = row.querySelector<HTMLElement>(".title")!;
    return { row: row.getBoundingClientRect().width, titleHeight: title.getBoundingClientRect().height };
  });
  expect(overflow.row).toBeLessThanOrEqual(480);
  expect(overflow.titleHeight).toBeLessThan(24);
});

test("Todo close confirmation cancels with Escape and keeps project status separate", async ({ mountApp, page }) => {
  await mountApp();
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  const close = page.getByRole("checkbox", { name: "Close issue: Fix the login flow", exact: true });
  await close.click();
  await expect(page.getByRole("group", { name: "Confirm closing issue" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(close).not.toBeChecked();
  await expect(close).toBeFocused();
  await close.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(close).toBeFocused();
  await close.click();
  await page.getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(page.locator("li.issue").filter({ hasText: "Fix the login flow" })).toHaveCount(0);
  const mutations = await page.evaluate(() => (window as unknown as { __ipcLog: Array<{ cmd: string; args: Record<string, unknown> }> }).__ipcLog.filter((entry) => entry.cmd === "toggle_issue_state" || entry.cmd === "update_project_item_field"));
  expect(mutations).toHaveLength(1);
  expect(mutations[0].cmd).toBe("toggle_issue_state");
  expect(mutations[0].args.closed).toBe(true);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByText("Fix the login flow", { exact: true })).toBeVisible();
});

test("failed Todo close retains the issue and can be retried", async ({ mountApp, page }) => {
  await mountApp({ errors: { toggle_issue_state: "Network unavailable" } });
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await page.getByRole("checkbox", { name: "Close issue: Fix the login flow", exact: true }).click();
  await page.getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn’t close the issue");
  await expect(page.getByRole("group", { name: "Confirm closing issue" })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __SCENARIO__: { errors: Record<string, string> } }).__SCENARIO__.errors = {}; });
  await page.getByRole("button", { name: "Close issue", exact: true }).click();
  await expect(page.locator("li.issue").filter({ hasText: "Fix the login flow" })).toHaveCount(0);
});

test("failed mark-read rolls back the notification and offers Retry", async ({ mountApp, page }) => {
  await mountApp({ errors: { mark_notification_read: "Network unavailable" } });
  await page.getByRole("button", { name: /Inbox/ }).click();
  const row = page.locator("li.issue").filter({ hasText: "Fix the login flow" });
  await row.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn’t mark this notification read");
  await expect(row).not.toHaveClass(/read/);
  await page.evaluate(() => { (window as unknown as { __SCENARIO__: { errors: Record<string, string> } }).__SCENARIO__.errors = {}; });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(row).toHaveClass(/read/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("failed Inbox fetch never claims Inbox zero", async ({ mountApp, page }) => {
  await mountApp({ inbox: [], errors: { fetch_inbox: "Network unavailable" } });
  await page.getByRole("button", { name: /Inbox/ }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn’t sync your inbox");
  await expect(page.getByText("Inbox zero", { exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { __SCENARIO__: { errors: Record<string, string> } }).__SCENARIO__.errors = {}; });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Inbox zero", { exact: true })).toBeVisible();
});
