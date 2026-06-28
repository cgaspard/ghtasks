import { test, expect } from "./fixtures/app";

test.describe("Settings", () => {
  test("opens via the avatar menu and shows accordion sections", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: "octocat" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();

    await expect(page.getByRole("button", { name: /Sources/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /General/ })).toBeVisible();
  });

  test("General section exposes window-size and poll interval", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: "octocat" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();

    // General is open by default.
    await expect(page.getByText("Poll interval (seconds)")).toBeVisible();
    await expect(page.getByText("Window size")).toBeVisible();
    await expect(page.getByText("Launch at login")).toBeVisible();
  });

  test("Sources section lists configured sources", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: "octocat" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.getByRole("button", { name: /Sources/ }).click();

    await expect(page.getByText("Roadmap")).toBeVisible();
    await expect(page.getByText("hello-world bugs")).toBeVisible();
  });
});

test.describe("Issue detail", () => {
  test("renders title, body markdown, and a comment", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await row.getByRole("button", { name: "View issue" }).click();

    await expect(page.getByRole("heading", { name: /Fix the login flow/ })).toBeVisible();
    // Markdown bold renders to <strong>.
    await expect(page.locator(".md strong").first()).toBeVisible();
    // GFM task-list checkboxes render (regression guard: they were being
    // stripped because "input" was in both ALLOWED_TAGS and FORBID_TAGS).
    await expect(
      page.locator('.md input[type="checkbox"]').first(),
    ).toBeVisible();
    // The seeded comment is shown.
    await expect(page.getByText("I can repro on Safari.")).toBeVisible();
  });

  test("Back returns to the list", async ({ mountApp, page }) => {
    await mountApp();
    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await row.getByRole("button", { name: "View issue" }).click();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();

    await page.getByRole("button", { name: "Back" }).click();
    // Board is back; filter input visible again.
    await expect(
      page.getByPlaceholder("Filter by title, label, or #number…"),
    ).toBeVisible();
  });

  test("Escape from detail returns to the list", async ({ mountApp, page }) => {
    await mountApp();
    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await row.getByRole("button", { name: "View issue" }).click();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(
      page.getByPlaceholder("Filter by title, label, or #number…"),
    ).toBeVisible();
  });
});
