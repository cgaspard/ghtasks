// Records a scripted product demo of GitHub Tasks driving the real Svelte
// frontend with the hero dataset. NOT a test. Produces a .webm under
// docs/marketing/video/raw/ which a post-step converts to mp4 + gif.
//
// Run:  npx playwright test demo.spec.ts
import { test } from "@playwright/test";
import { TAURI_MOCK_INIT } from "./fixtures/tauriMock";
import { defaultScenario } from "./fixtures/app";
import type { Scenario } from "./fixtures/tauriMock";
import * as hero from "./fixtures/marketingData";

const W = 460;
const H = 640;

function heroScenario(): Scenario {
  return {
    ...defaultScenario(),
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
  } as Scenario;
}

// A calm cadence so viewers can follow. Playwright records at real time.
const beat = (page: import("@playwright/test").Page, ms = 900) =>
  page.waitForTimeout(ms);

test("product demo", async ({ browser }) => {
  test.setTimeout(120_000); // scripted walkthrough runs ~20s in real time
  // Record at DPR 1 with size == viewport so the whole page paints into the
  // video canvas (DPR 2 leaves the bottom of the canvas unpainted/grey).
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: "docs/marketing/video/raw", size: { width: W, height: H } },
  });
  const page = await context.newPage();
  await page.addInitScript(
    (s) => {
      (window as unknown as { __SCENARIO__: unknown }).__SCENARIO__ = s;
    },
    heroScenario() as unknown,
  );
  await page.addInitScript(TAURI_MOCK_INIT);

  await page.goto("http://localhost:1420/");

  // The app makes html/body transparent + rounds #app corners so the real
  // Tauri window floats on the desktop. In a browser recording that
  // transparency shows as grey; paint an opaque dark bg and square off #app
  // so the clip is full-bleed dark (the frame adds its own rounded chrome).
  await page.addStyleTag({
    content:
      "html,body{background:#0d1117 !important}#app{border-radius:0 !important}",
  });

  // --- Projects: the cross-repo board ---
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.getByText("Payments: retry failed Stripe webhooks").waitFor();
  await beat(page, 1400);

  // Filter by status — the checkbox multi-select.
  await page.locator(".picker", { hasText: "Status" }).locator(".trigger").click();
  await page.locator(".menu").waitFor();
  await beat(page, 900);
  await page.locator(".menu .opt", { hasText: "In Progress" }).click();
  await beat(page, 700);
  await page.locator(".menu .opt", { hasText: "In Review" }).click();
  await beat(page, 1300);
  // Close the popover.
  await page.locator(".toolbar, .topbar, body").first().click({ position: { x: 5, y: 5 } });
  await beat(page, 900);
  // Clear the filter back to All.
  await page.locator(".picker", { hasText: "Status" }).locator(".trigger").click();
  await page.locator(".menu .ghost", { hasText: "Clear" }).click();
  await page.keyboard.press("Escape");
  await beat(page, 900);

  // --- Issues: repo search across sources ---
  await page.getByRole("button", { name: "Issues", exact: true }).click();
  await page.getByText("Payments: retry failed Stripe webhooks").waitFor();
  await beat(page, 1400);

  // --- Inbox: the notifications mirror ---
  await page.getByRole("button", { name: /Inbox/ }).click();
  await page.getByText("Theme tokens + dark palette").first().waitFor();
  await beat(page, 1400);

  // Category checkbox filter — pick two categories, then clear back to All.
  await page.locator(".filter .trigger").click();
  await page.locator(".filter .menu").waitFor();
  await beat(page, 900);
  await page.locator(".filter .opt", { hasText: "Review requested" }).click();
  await beat(page, 650);
  await page.locator(".filter .opt", { hasText: "Mentioned" }).click();
  await beat(page, 1300);
  await page.locator(".filter .menu .ghost", { hasText: "Clear" }).click();
  await beat(page, 700);
  await page.keyboard.press("Escape");
  await beat(page, 800);

  // Unread-only toggle — narrow to unread, then back to the full mirror.
  await page.locator(".filter .unread-toggle").click();
  await beat(page, 1500);
  await page.locator(".filter .unread-toggle").click();
  await beat(page, 1200);

  await context.close(); // flush the video to disk
});
