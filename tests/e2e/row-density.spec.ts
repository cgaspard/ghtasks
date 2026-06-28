import { test, expect } from "./fixtures/app";

// Row density (Settings → General) switches the list between three presets:
//   compact      → 2 rows, labels fold inline onto row 2 (truncated)
//   default      → 3 rows; row 2 (PR · repo · time) never wraps, labels on row 3
//   comfortable  → 3 rows, same structure, larger type/padding
// The list communicates the active preset via `data-density` on <ul.issues>.

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "octocat" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
}

test.describe("row density", () => {
  test("defaults to 'default' on the Projects list", async ({ mountApp }) => {
    const page = await mountApp();
    await expect(page.locator("ul.issues")).toHaveAttribute(
      "data-density",
      "default",
    );
  });

  test("the Issues list also carries the density attribute", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: "Issues", exact: true }).click();
    await expect(page.locator("ul.issues")).toHaveAttribute(
      "data-density",
      "default",
    );
  });

  test("changing density in Settings updates the list live", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await openSettings(page);

    // The 3-way segmented control.
    await page.locator(".seg-btn", { hasText: "Compact" }).click();

    // Back to the board — the attribute reflects the new preset without reload.
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await expect(page.locator("ul.issues")).toHaveAttribute(
      "data-density",
      "compact",
    );

    // And it was persisted via save_settings with the new value.
    const saved = await page.evaluate(() => {
      const log = (
        window as unknown as {
          __ipcLog: Array<{ cmd: string; args: Record<string, unknown> }>;
        }
      ).__ipcLog;
      return log
        .filter((e) => e.cmd === "save_settings")
        .map(
          (e) =>
            (e.args.settings as { row_density?: string } | undefined)
              ?.row_density,
        );
    });
    expect(saved).toContain("compact");
  });

  test("comfortable preset applies to both tabs", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await openSettings(page);
    await page.locator(".seg-btn", { hasText: "Comfortable" }).click();

    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await expect(page.locator("ul.issues")).toHaveAttribute(
      "data-density",
      "comfortable",
    );

    await page.getByRole("button", { name: "Issues", exact: true }).click();
    await expect(page.locator("ul.issues")).toHaveAttribute(
      "data-density",
      "comfortable",
    );
  });

  test("a persisted (backend) density hydrates the list on load", async ({
    mountApp,
  }) => {
    // Simulates a prior session that saved "comfortable": the backend
    // getSettings() returns it, and App.svelte hydrates the list to match.
    const page = await mountApp({
      settings: {
        default_repo: "octocat/hello-world",
        poll_interval_secs: 90,
        launch_at_login: false,
        window_size: "default",
        row_density: "comfortable",
      },
    });
    await expect(page.locator("ul.issues")).toHaveAttribute(
      "data-density",
      "comfortable",
    );
  });

  test("an empty/legacy density value falls back to default on load", async ({
    mountApp,
  }) => {
    // Older installs (or Settings::default() with an empty store) may send "".
    // resolveRowDensity() must coerce it to "default" so layout never breaks.
    const page = await mountApp({
      settings: {
        default_repo: null,
        poll_interval_secs: 90,
        launch_at_login: false,
        window_size: "default",
        row_density: "" as unknown as "default",
      },
    });
    await expect(page.locator("ul.issues")).toHaveAttribute(
      "data-density",
      "default",
    );
  });

  test("default & comfortable keep a 3rd row for labels; compact folds it away", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    // #92 "Fix the login flow" carries labels + a milestone (see mockData).
    const row = () =>
      page.locator("li.issue").filter({ hasText: "Fix the login flow" });

    // Default: dedicated labels row is present and visible.
    await expect(row().locator(".row3")).toBeVisible();

    // Switch to Compact → the labels row3 is hidden (labels fold onto row2).
    await openSettings(page);
    await page.locator(".seg-btn", { hasText: "Compact" }).click();
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await expect(row().locator(".row3")).toBeHidden();
    // The inline compact labels element is now shown instead.
    await expect(row().locator(".row2-labels")).toBeVisible();
  });

  test("row 2 never wraps in default density, even with long labels", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    const row2 = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" })
      .locator(".row2");

    // A single text line at this font size is well under 22px tall. If row 2
    // wrapped (PR + repo + time spilling), it would roughly double. Asserting a
    // tight upper bound proves the no-wrap guarantee holds.
    const height = await row2.evaluate((el) => (el as HTMLElement).clientHeight);
    expect(height).toBeLessThan(22);
  });
});
