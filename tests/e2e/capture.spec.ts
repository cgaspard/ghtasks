// Marketing capture harness — NOT a test. Drives the real Svelte frontend
// with the rich "hero" dataset and writes retina PNGs to docs/marketing/shots.
// Run explicitly:  npx playwright test capture.spec.ts
//
// These are captured at deviceScaleFactor 2 for crisp README / landing-page
// imagery. A separate compositing step frames them on a branded backdrop.
import { test } from "./fixtures/app";
import type { Scenario } from "./fixtures/tauriMock";
import * as hero from "./fixtures/marketingData";

const SHOTS = "docs/marketing/shots";

/** The full hero scenario, overriding the default fixture data end-to-end. */
function heroScenario(): Partial<Scenario> {
  return {
    auth: hero.HERO_AUTH,
    sources: hero.HERO_SOURCES,
    sourceResults: hero.HERO_SOURCE_RESULTS,
    projectPages: [hero.HERO_PROJECT_PAGE],
    settings: hero.HERO_SETTINGS,
    projects: hero.HERO_PROJECT_SUMMARIES,
    repos: hero.HERO_REPOS,
    inbox: hero.HERO_INBOX,
    inboxHasMore: false,
    notificationPermissionStatus: true,
    version: "0.5.0",
  };
}

// A generous but menu-bar-app-shaped window. Height gives ~7 rows of breathing
// room; width matches the app's "Large" preset feel.
const W = 460;
const H = 640;

test.use({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });

test.describe("marketing captures", () => {
  test("projects tab", async ({ mountApp, page }) => {
    await mountApp(heroScenario());
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page.getByText("Payments: retry failed Stripe webhooks").waitFor();
    await page.screenshot({ path: `${SHOTS}/projects.png` });
  });

  test("projects with status filter open", async ({ mountApp, page }) => {
    await mountApp(heroScenario());
    await page.getByRole("button", { name: "Projects", exact: true }).click();
    await page.getByText("Payments: retry failed Stripe webhooks").waitFor();
    // Open the Status FilterPicker to show the checkbox filtering.
    await page.locator(".picker", { hasText: "Status" }).locator(".trigger").click();
    await page.locator(".menu").waitFor();
    await page.screenshot({ path: `${SHOTS}/projects-status-filter.png` });
  });

  test("issues tab", async ({ mountApp, page }) => {
    await mountApp(heroScenario());
    await page.getByRole("button", { name: "Issues", exact: true }).click();
    await page.getByText("Payments: retry failed Stripe webhooks").waitFor();
    await page.screenshot({ path: `${SHOTS}/issues.png` });
  });

  test("inbox tab", async ({ mountApp, page }) => {
    await mountApp(heroScenario());
    await page.getByRole("button", { name: /Inbox/ }).click();
    await page.getByText("Theme tokens + dark palette").first().waitFor();
    await page.screenshot({ path: `${SHOTS}/inbox.png` });
  });

  test("inbox category filter open", async ({ mountApp, page }) => {
    await mountApp(heroScenario());
    await page.getByRole("button", { name: /Inbox/ }).click();
    await page.getByText("Theme tokens + dark palette").first().waitFor();
    await page.locator(".filter .trigger").click();
    await page.screenshot({ path: `${SHOTS}/inbox-filter.png` });
  });

  test("new issue modal", async ({ mountApp, page }) => {
    await mountApp(heroScenario());
    await page.getByRole("button", { name: "New issue" }).click();
    // Wait for the modal's title field to be ready.
    await page.getByPlaceholder(/title/i).first().waitFor();
    await page.getByPlaceholder(/title/i).first().fill("Add keyboard shortcut to jump to Inbox");
    await page.screenshot({ path: `${SHOTS}/new-issue.png` });
  });

  test("settings", async ({ mountApp, page }) => {
    await mountApp(heroScenario());
    // Open the avatar menu, then Settings.
    await page.locator(".avatar-btn").click();
    await page.locator(".menu[role='menu']").waitFor();
    await page.locator(".menu-item").filter({ hasText: "Settings" }).click();
    await page.getByText(/Sources/i).first().waitFor();
    await page.screenshot({ path: `${SHOTS}/settings.png` });
  });
});
