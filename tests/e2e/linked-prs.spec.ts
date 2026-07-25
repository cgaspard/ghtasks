import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures/app";

// The linked-PR + milestone badges are rendered by LinkedBadges.svelte and
// surface on BOTH tabs. Fixtures in mockData.ts attach:
//   - #92  → milestone "v1.0" + open PR #410
//   - #922 → merged PR #411
const SHOTS = "docs/screenshots";

/** Refresh the tracked badge screenshots. Gated on CAPTURE (like the marketing
 * generators in playwright.config.ts) so a plain `npm test` never rewrites
 * committed binaries and leaves the working tree dirty. */
async function capture(page: Page, name: string) {
  if (!process.env.CAPTURE) return;
  // Capture at the real popover width, not the default 1280px page.
  await page.setViewportSize({ width: 400, height: 600 });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe("linked PR + milestone badges", () => {
  test("Projects tab shows the linked-PR badge and milestone pill", async ({
    mountApp,
  }) => {
    const page = await mountApp();

    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });

    // Milestone pill (title attr carries the full milestone name).
    await expect(row.locator('button.milestone[title*="v1.0"]')).toBeVisible();
    // Linked open PR badge — visible text is the PR number, title carries identity.
    await expect(
      row.locator('button.pr[title*="open PR octocat/hello-world#410"]'),
    ).toBeVisible();
    await expect(row.locator("button.pr")).toContainText("PR #410");

    // A different row carries a MERGED PR.
    const merged = page
      .locator("li.issue")
      .filter({ hasText: "Refactor the sync engine" });
    await expect(
      merged.locator('button.pr[title*="merged PR octocat/hello-world#411"]'),
    ).toBeVisible();

    await capture(page, "projects-linked-pr");
  });

  test("clicking the PR badge opens the PR url in the browser", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });

    await row
      .locator('button.pr[title*="open PR octocat/hello-world#410"]')
      .click();

    // openUrl() routes through the mocked opener plugin; the URL lands in the
    // IPC log as the opener's `url` arg.
    const opened = await page.evaluate(() => {
      const log = (
        window as unknown as {
          __ipcLog: Array<{ cmd: string; args: Record<string, unknown> }>;
        }
      ).__ipcLog;
      return log
        .filter((e) => e.cmd === "plugin:opener|open_url")
        .map((e) => e.args.url ?? e.args.path);
    });
    expect(opened).toContain("https://github.com/octocat/hello-world/pull/410");
  });

  test("Issues tab shows the same badges (REST enrichment path)", async ({
    mountApp,
  }) => {
    const page = await mountApp();
    await page.getByRole("button", { name: "Issues", exact: true }).click();

    const row = page
      .locator("li.issue")
      .filter({ hasText: "Fix the login flow" });
    await expect(row.locator('button.milestone[title*="v1.0"]')).toBeVisible();
    await expect(
      row.locator('button.pr[title*="open PR octocat/hello-world#410"]'),
    ).toBeVisible();

    await capture(page, "issues-linked-pr");
  });

  test("an issue with no linked PR shows no PR badge", async ({ mountApp }) => {
    const page = await mountApp();
    const row = page
      .locator("li.issue")
      .filter({ hasText: "Add dark mode toggle" });
    await expect(row.locator("button.badge.pr")).toHaveCount(0);
  });
});
