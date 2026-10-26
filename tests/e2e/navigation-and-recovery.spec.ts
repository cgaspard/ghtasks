import { test, expect } from "./fixtures/app";
import { SETTINGS } from "./fixtures/mockData";

test("main navigation leaves issue details and opens the focused Settings home", async ({ mountApp, page }) => {
  await mountApp();
  await page.locator("li.issue").filter({ hasText: "Fix the login flow" }).getByRole("button", { name: "View issue", exact: true }).click();
  await expect(page.getByText(/login button does/i)).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Todos", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /Close issue/ }).first()).toBeVisible();
});

test("saved refresh interval changes the running poll timer", async ({ mountApp, page }) => {
  await page.clock.install();
  await mountApp({ settings: { ...SETTINGS, poll_interval_secs: 30 } });
  const fetchCount = () => page.evaluate(() => (window as unknown as { __ipcLog: Array<{ cmd: string }> }).__ipcLog.filter((call) => call.cmd === "fetch_all").length);
  await expect.poll(fetchCount).toBe(1);
  await page.clock.fastForward(30_001);
  await expect.poll(fetchCount).toBe(2);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /General.*Startup/ }).click();
  await page.getByRole("button", { name: "Refresh automatically", exact: true }).click();
  await page.getByRole("option", { name: "Every minute", exact: true }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Saved");
  await page.clock.fastForward(30_001);
  expect(await fetchCount()).toBe(2);
  await page.clock.fastForward(30_001);
  await expect.poll(fetchCount).toBe(3);
});

test("failed sign-in offers a new code and a way to cancel", async ({ mountApp, page }) => {
  await mountApp({ auth: { authenticated: false, user: null }, errors: { auth_poll: "auth denied" } });
  await page.getByRole("button", { name: "Sign in with GitHub", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Get a new code");
  await page.getByRole("button", { name: "Get a new code", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ipcLog: Array<{ cmd: string }> }).__ipcLog.filter((call) => call.cmd === "auth_start").length)).toBe(2);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in with GitHub", exact: true })).toBeVisible();
});
