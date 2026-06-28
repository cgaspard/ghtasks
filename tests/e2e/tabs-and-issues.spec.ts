import { test, expect } from "./fixtures/app";

test.describe("tab navigation + Issues tab", () => {
  test("switching to Issues shows repo-search results", async ({ mountApp }) => {
    const page = await mountApp();
    await page.getByRole("button", { name: "Issues", exact: true }).click();

    // REPO_ISSUES from mockData.
    await expect(page.getByText("Update the README")).toBeVisible();
    await expect(page.getByText("Fix the login flow")).toBeVisible();
  });

  test("Issues tab number filter works the same as Projects", async ({
    mountApp,
  }) => {
    const page = await mountApp();
    await page.getByRole("button", { name: "Issues", exact: true }).click();
    await expect(page.getByText("Update the README")).toBeVisible();

    await page
      .getByPlaceholder("Filter by title, label, or #number…")
      .fill("#92");
    // "#92" is an EXACT number search → only issue #92, not #922 or #305.
    await expect(page.getByText("Fix the login flow")).toBeVisible();
    await expect(page.getByText("Refactor the sync engine")).toHaveCount(0);
    await expect(page.getByText("Update the README")).toHaveCount(0);
  });

  test("Issues tab label filter matches", async ({ mountApp }) => {
    const page = await mountApp();
    await page.getByRole("button", { name: "Issues", exact: true }).click();
    await page
      .getByPlaceholder("Filter by title, label, or #number…")
      .fill("tech-debt");
    await expect(page.getByText("Refactor the sync engine")).toBeVisible();
    await expect(page.getByText("Update the README")).toHaveCount(0);
  });

  test("active tab persists across reload (localStorage)", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: "Issues", exact: true }).click();
    await expect(page.getByText("Update the README")).toBeVisible();

    await page.reload();
    // Still on Issues after reload.
    await expect(page.getByText("Update the README")).toBeVisible();
  });

  test("empty Issues source shows a friendly empty state", async ({
    mountApp,
  }) => {
    const page = await mountApp({
      sourceResults: [{ source_id: "src-repo-1", issues: [], error: null }],
    });
    await page.getByRole("button", { name: "Issues", exact: true }).click();
    await expect(page.getByText(/No issues match/i)).toBeVisible();
  });
});
