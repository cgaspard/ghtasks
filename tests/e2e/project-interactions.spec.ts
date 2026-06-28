import { test, expect } from "./fixtures/app";

test.describe("Projects tab — interactions", () => {
  test("status picker shows the item's current status", async ({ mountApp }) => {
    const page = await mountApp();
    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await expect(row.getByText("In Progress")).toBeVisible();
  });

  test("changing status optimistically updates the pill", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    const row = page
      .locator("li.issue")
      .filter({ hasText: "Add dark mode toggle" });

    // Opens this row's status picker (currently "Todo").
    await row.getByRole("button", { name: /Todo/ }).click();
    // Pick "Done" from the menu.
    await page.getByRole("menu").getByText("Done", { exact: true }).click();

    // Optimistic update: pill now reads Done for this row.
    await expect(row.getByText("Done")).toBeVisible();
  });

  test("status filter narrows the board", async ({ mountApp, page }) => {
    await mountApp();
    await expect(page.getByText("Fix the login flow")).toBeVisible();

    // Open the Status filter popover and select only "Done".
    await page.getByRole("button", { name: /^Status:/ }).click();
    const menu = page.getByRole("menu");
    await menu.getByText("Done", { exact: true }).click();
    // Close popover by clicking the trigger again (or elsewhere).
    await page.keyboard.press("Escape");

    // Only the Done item remains.
    await expect(page.getByText("Write onboarding docs")).toBeVisible();
    await expect(page.getByText("Fix the login flow")).toHaveCount(0);
  });

  test("custom field (Priority) filter narrows the board", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await expect(page.getByText("Fix the login flow")).toBeVisible();

    // Pick the Priority field from the "Filter by…" select.
    await page.getByText("Filter by…").click();
    await page.getByRole("option", { name: "Priority" }).click();

    // Now a Priority FilterPicker appears; select P0.
    await page.getByRole("button", { name: /^Priority:/ }).click();
    await page.getByRole("menu").getByText("P0", { exact: true }).click();
    await page.keyboard.press("Escape");

    // Only #92 (P0) remains.
    await expect(page.getByText("Fix the login flow")).toBeVisible();
    await expect(page.getByText("Add dark mode toggle")).toHaveCount(0);
  });

  test("drilling into an item opens the detail view", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await row.getByRole("button", { name: "View issue" }).click();

    // Detail view: Back button + issue body render.
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
    await expect(page.getByText(/login button does/i)).toBeVisible();
  });
});
