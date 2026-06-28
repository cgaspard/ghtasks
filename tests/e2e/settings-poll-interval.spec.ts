import { test, expect } from "./fixtures/app";

/** Read every save_settings payload the frontend sent to the (mock) backend. */
async function savedSettings(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const log = (window as unknown as { __ipcLog: Array<{ cmd: string; args: unknown }> })
      .__ipcLog;
    return log
      .filter((e) => e.cmd === "save_settings")
      .map((e) => (e.args as { settings: { poll_interval_secs: number } }).settings);
  });
}

test.describe("Settings — poll interval clamp", () => {
  test.beforeEach(async ({ mountApp, page }) => {
    await mountApp();
    await page.getByRole("button", { name: "octocat" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect(page.getByText("Poll interval (seconds)")).toBeVisible();
  });

  test("a valid value is saved as-is", async ({ page }) => {
    const input = page.getByRole("spinbutton");
    await input.fill("120");
    await input.blur();

    const saves = await savedSettings(page);
    expect(saves.at(-1)?.poll_interval_secs).toBe(120);
  });

  test("clearing the field never sends NaN — clamps to the floor", async ({
    page,
  }) => {
    const input = page.getByRole("spinbutton");
    await input.fill(""); // empty number input → would be NaN/0 without the guard
    await input.blur();

    const saves = await savedSettings(page);
    const last = saves.at(-1)?.poll_interval_secs;
    expect(Number.isFinite(last)).toBe(true);
    expect(last).toBeGreaterThanOrEqual(30);
  });

  test("an over-max value is clamped to 3600", async ({ page }) => {
    const input = page.getByRole("spinbutton");
    await input.fill("999999");
    await input.blur();

    const saves = await savedSettings(page);
    expect(saves.at(-1)?.poll_interval_secs).toBe(3600);
  });

  test("a below-min value is clamped to 30", async ({ page }) => {
    const input = page.getByRole("spinbutton");
    await input.fill("5");
    await input.blur();

    const saves = await savedSettings(page);
    expect(saves.at(-1)?.poll_interval_secs).toBe(30);
  });

  test("a fractional value is rounded to an integer", async ({ page }) => {
    const input = page.getByRole("spinbutton");
    await input.fill("90.7");
    await input.blur();

    const saves = await savedSettings(page);
    expect(saves.at(-1)?.poll_interval_secs).toBe(91);
  });
});
