import { test, expect } from "./fixtures/app";

async function openSettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}

test.describe("Settings", () => {
  test("opens a focused settings home with five destinations", async ({ mountApp, page }) => {
    await mountApp();
    await openSettings(page);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    for (const name of [/Projects & repositories/, /Appearance/, /Notifications/, /General/, /About & updates/]) {
      await expect(page.getByRole("navigation", { name: "Settings categories" }).getByRole("button", { name })).toBeVisible();
    }
  });

  test("General keeps refresh, repository and startup preferences together", async ({ mountApp, page }) => {
    await mountApp();
    await openSettings(page);
    await page.getByRole("button", { name: /General Startup/ }).click();
    await expect(page.getByText("Default repository for new issues", { exact: true })).toBeVisible();
    await expect(page.getByText("Refresh automatically", { exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Open GitHub Tasks when I sign in/ })).toBeVisible();
    await expect(page.getByText("Window height", { exact: true })).toHaveCount(0);
  });

  test("Projects & repositories lists named, manageable connections", async ({ mountApp, page }) => {
    await mountApp();
    await openSettings(page);
    await page.getByRole("button", { name: /Projects & repositories Choose/ }).click();
    await expect(page.getByRole("button", { name: "Manage Roadmap", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage hello-world bugs", exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Show Roadmap in my task list", exact: true })).toBeChecked();
  });

  test("notification permission and read-state behavior have their own page", async ({ mountApp, page }) => {
    await mountApp({ notificationPermissionStatus: false });
    await openSettings(page);
    await page.getByRole("button", { name: /Notifications Desktop/ }).click();
    await expect(page.getByRole("heading", { name: "Desktop notifications are turned off" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Mark notifications read when I open an item/ })).toBeVisible();
    await expect(page.getByText(/Inbox’s “Mark read” always updates GitHub/)).toBeVisible();
  });

  test("denied alerts do not appear as a warning in unrelated preferences", async ({ mountApp, page }) => {
    await mountApp({ notificationPermissionStatus: false });
    await openSettings(page);
    await page.getByRole("button", { name: /General Startup/ }).click();
    await expect(page.getByText("Desktop notifications are turned off", { exact: true })).toHaveCount(0);
  });

  test("a failed preference save rolls back and can be retried", async ({ mountApp, page }) => {
    await mountApp({ errors: { save_settings: "Offline" } });
    await openSettings(page);
    await page.getByRole("button", { name: /General Startup/ }).click();
    const startup = page.getByRole("checkbox", { name: /Open GitHub Tasks when I sign in/ });
    await startup.click();
    await expect(page.getByRole("alert")).toContainText("Couldn’t save your change");
    await expect(startup).not.toBeChecked();
    await page.evaluate(() => { (window as unknown as { __SCENARIO__: { errors: Record<string, string> } }).__SCENARIO__.errors = {}; });
    await page.getByRole("button", { name: "Retry change", exact: true }).click();
    await expect(startup).toBeChecked();
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  });

  test("all settings remain reachable in the compact window", async ({ mountApp, page }) => {
    await page.setViewportSize({ width: 480, height: 560 });
    await mountApp({ notificationPermissionStatus: false });
    await openSettings(page);
    await page.getByRole("button", { name: /About & updates Version/ }).click();
    const signout = page.getByRole("button", { name: "Sign out", exact: true });
    await signout.scrollIntoViewIfNeeded();
    await expect(signout).toBeInViewport();
    await page.getByRole("button", { name: "← Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  });

  test("repository setup defaults to my open issues and retains advanced search", async ({ mountApp, page }) => {
    await mountApp();
    await openSettings(page);
    await page.getByRole("button", { name: /Projects & repositories Choose/ }).click();
    await page.getByRole("button", { name: "+ Add connection", exact: true }).click();
    await page.getByRole("group", { name: "Connection type" }).getByRole("button", { name: "Repository", exact: true }).click();
    await page.getByLabel("Repository", { exact: true }).click();
    await page.getByRole("option", { name: /octocat\/hello-world/ }).click();
    await expect(page.getByRole("button", { name: "Which issues?", exact: true })).toContainText("My open issues");
    await page.getByText("More options", { exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Custom GitHub search", exact: true })).toHaveValue("is:issue is:open assignee:@me");
    await page.getByRole("button", { name: "Add repository", exact: true }).click();
    const saved = await page.evaluate(() => (window as unknown as { __ipcLog: { cmd: string; args: { source?: { query?: string } } }[] }).__ipcLog.filter((e) => e.cmd === "save_source").at(-1)?.args.source);
    expect(saved?.query).toBe("is:issue is:open assignee:@me");
  });

  test("removing a connection requires confirmation and failed removal keeps it", async ({ mountApp, page }) => {
    await mountApp({ errors: { delete_source: "No connection" } });
    await openSettings(page);
    await page.getByRole("button", { name: /Projects & repositories Choose/ }).click();
    await page.getByRole("button", { name: "Manage Roadmap", exact: true }).click();
    await page.locator("summary").filter({ hasText: "Remove connection" }).click();
    await page.getByRole("button", { name: "Remove connection", exact: true }).click();
    const confirmation = page.getByRole("group", { name: "Confirm removing connection", exact: true });
    await expect(confirmation).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __ipcLog: { cmd: string }[] }).__ipcLog.filter((e) => e.cmd === "delete_source").length)).toBe(0);
    await confirmation.getByRole("button", { name: "Remove connection", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("No connection");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Manage Roadmap", exact: true })).toBeVisible();
  });

  test("an unsaved connection draft survives leaving its settings page", async ({ mountApp, page }) => {
    await mountApp();
    await openSettings(page);
    await page.getByRole("button", { name: /Projects & repositories Choose/ }).click();
    await page.getByRole("button", { name: "+ Add connection", exact: true }).click();
    await page.getByRole("textbox", { name: "Display name", exact: true }).fill("My saved draft");
    await page.getByRole("button", { name: "← Settings", exact: true }).click();
    await page.getByRole("button", { name: /Projects & repositories Choose/ }).click();
    await expect(page.getByRole("textbox", { name: "Display name", exact: true })).toHaveValue("My saved draft");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "+ Add connection", exact: true })).toBeVisible();
  });

  test("connection type buttons preserve the active and alternate drafts", async ({ mountApp, page }) => {
    await mountApp();
    await openSettings(page);
    await page.getByRole("button", { name: /Projects & repositories Choose/ }).click();
    await page.getByRole("button", { name: "+ Add connection", exact: true }).click();
    const kinds = page.getByRole("group", { name: "Connection type", exact: true });
    const name = page.getByRole("textbox", { name: "Display name", exact: true });
    await page.getByLabel("Project board", { exact: true }).click();
    await page.getByRole("option", { name: /Roadmap/ }).click();
    await name.fill("Project draft");
    await page.locator("summary").filter({ hasText: "More options" }).click();
    await page.getByRole("textbox", { name: "Filter project items", exact: true }).fill("-status:Done");
    await kinds.getByRole("button", { name: "Project board", exact: true }).click();
    await expect(name).toHaveValue("Project draft");
    await expect(page.getByLabel("Project board", { exact: true })).toContainText("Roadmap");
    await expect(page.getByRole("textbox", { name: "Filter project items", exact: true })).toHaveValue("-status:Done");

    await kinds.getByRole("button", { name: "Repository", exact: true }).click();
    await page.getByLabel("Repository", { exact: true }).click();
    await page.getByRole("option", { name: /octocat\/hello-world/ }).click();
    await name.fill("Repository draft");
    await page.getByRole("textbox", { name: "Custom GitHub search", exact: true }).fill("is:issue is:open label:bug");
    await kinds.getByRole("button", { name: "Repository", exact: true }).click();
    await expect(name).toHaveValue("Repository draft");
    await expect(page.getByRole("textbox", { name: "Custom GitHub search", exact: true })).toHaveValue("is:issue is:open label:bug");

    await kinds.getByRole("button", { name: "Project board", exact: true }).click();
    await expect(name).toHaveValue("Project draft");
    await expect(page.getByRole("textbox", { name: "Filter project items", exact: true })).toHaveValue("-status:Done");
    await kinds.getByRole("button", { name: "Repository", exact: true }).click();
    await expect(name).toHaveValue("Repository draft");
    await expect(page.getByLabel("Repository", { exact: true })).toContainText("octocat/hello-world");
    await expect(page.getByRole("textbox", { name: "Custom GitHub search", exact: true })).toHaveValue("is:issue is:open label:bug");

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "+ Add connection", exact: true }).click();
    await expect(name).toHaveValue("");
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
