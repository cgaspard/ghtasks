import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for GH Tasks. The app is a Tauri WebView app; for repeatable
 * headless QA we run the Svelte frontend in Chromium and mock the Tauri IPC
 * layer (see tests/e2e/fixtures/tauriMock.ts). No Rust, no GitHub auth.
 *
 * Playwright boots the Vite dev server on :1420 and tears it down after.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Pure-logic unit specs live under tests/unit and run via vitest, not here.
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 15_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: "http://localhost:1420",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
