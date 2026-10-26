import { test, expect } from "./fixtures/app";
import { makeIssue, REPO_SOURCE } from "./fixtures/mockData";

test.describe("New Issue modal", () => {
  test("opens from the + New button and keeps the draft on Back", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: "+ New" }).click();

    const dialog = page.getByRole("dialog", { name: "New issue" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Keep draft & go back" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("Create is disabled until a title is entered", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: "+ New" }).click();
    const dialog = page.getByRole("dialog", { name: "New issue" });

    const create = dialog.getByRole("button", { name: /Create issue/ });
    await expect(create).toBeDisabled();

    await dialog.getByPlaceholder("What needs to be done?").fill("My new bug");
    await expect(create).toBeEnabled();
  });

  test("creating an issue in a repo optimistically inserts it", async ({
    mountApp,
    page,
  }) => {
    const created = makeIssue({
      number: 999,
      title: "Brand new issue",
      node_id: "N_NEW_999",
    });
    await mountApp({ createdIssue: created });

    // Go to Issues tab so we can see the optimistic insert.
    await page.getByRole("button", { name: "Todos", exact: true }).click();
    await page.getByRole("button", { name: "New issue", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New issue" });

    await expect(dialog.getByRole("button", { name: "Add to project", exact: true })).toHaveText(/No project/);
    await dialog.getByPlaceholder("What needs to be done?").fill("Brand new issue");

    await dialog.getByRole("button", { name: /Create issue/ }).click();

    // Modal closes and the new issue appears in the list.
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Brand new issue")).toBeVisible();
  });

  test("Escape closes the modal", async ({ mountApp, page }) => {
    await mountApp();
    await page.getByRole("button", { name: "+ New" }).click();
    await expect(page.getByRole("dialog", { name: "New issue" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New issue" })).toHaveCount(0);
  });

  test("title and description survive close, reopen, and reload; Discard clears them", async ({ mountApp, page }) => {
    await mountApp();
    const opener = page.getByRole("button", { name: "+ New", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "New issue", exact: true });
    await dialog.getByPlaceholder("What needs to be done?").fill("Keep my unfinished work");
    await dialog.getByPlaceholder("Notes, checklist…").fill("Details I do not want to lose.");
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(dialog.getByPlaceholder("What needs to be done?")).toHaveValue("Keep my unfinished work");
    await expect(dialog.getByPlaceholder("Notes, checklist…")).toHaveValue("Details I do not want to lose.");
    await page.reload();
    await opener.click();
    await expect(dialog.getByPlaceholder("What needs to be done?")).toHaveValue("Keep my unfinished work");
    await expect(dialog.getByPlaceholder("Notes, checklist…")).toHaveValue("Details I do not want to lose.");
    await dialog.getByRole("button", { name: "Discard draft", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("ghtasks.newIssueDraft"))).toBe("null");
    await opener.click();
    await expect(dialog.getByPlaceholder("What needs to be done?")).toHaveValue("");
  });

  test("repository-only creation works with no project connections", async ({ mountApp, page }) => {
    const created = makeIssue({ number: 991, title: "Repository issue", node_id: "NEW_REPO_ONLY" });
    await mountApp({ sources: [REPO_SOURCE], projectPages: [], createdIssue: created });
    await page.getByRole("button", { name: "Todos", exact: true }).click();
    await page.getByRole("button", { name: "New issue", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New issue", exact: true });
    await expect(dialog.getByRole("button", { name: "Repo only", exact: true })).toHaveCount(0);
    await dialog.getByPlaceholder("What needs to be done?").fill("Repository issue");
    await dialog.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Issue #991 created" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __ipcLog: Array<{ cmd: string }> }).__ipcLog.filter((call) => call.cmd === "create_issue").length)).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __ipcLog: Array<{ cmd: string }> }).__ipcLog.filter((call) => call.cmd === "create_issue_in_project").length)).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("ghtasks.newIssueDraft"))).toBe("null");
  });

  test("the optional project and initial status survive a reload and are submitted", async ({ mountApp, page }) => {
    await mountApp({ createdIssue: makeIssue({ number: 992, title: "Board issue", node_id: "NEW_BOARD" }) });
    const opener = page.getByRole("button", { name: "+ New", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "New issue", exact: true });
    await dialog.getByRole("button", { name: "Add to project", exact: true }).click();
    await page.getByRole("option", { name: "Roadmap", exact: true }).click();
    await dialog.getByRole("button", { name: "Initial project status", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Done", exact: true }).click();
    await dialog.getByPlaceholder("What needs to be done?").fill("Board issue");
    await page.reload();
    await opener.click();
    await expect(dialog.getByRole("button", { name: "Add to project", exact: true })).toHaveText(/Roadmap/);
    await expect(dialog.getByRole("button", { name: "Initial project status", exact: true })).toHaveText(/Done/);
    await dialog.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const input = await page.evaluate(() => (window as unknown as { __ipcLog: Array<{ cmd: string; args: unknown }> }).__ipcLog.find((call) => call.cmd === "create_issue_in_project")?.args);
    expect(input).toMatchObject({ repo: "octocat/hello-world", projectId: "PVT_kwProject1", statusFieldId: "FIELD_status", statusOptionId: "OPT_done" });
  });

  test("Escape closes the dropdown first and Tab stays within the modal", async ({ mountApp, page }) => {
    await mountApp();
    await page.getByRole("button", { name: "+ New", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New issue", exact: true });
    await dialog.getByPlaceholder("What needs to be done?").fill("Keyboard navigation");
    const repo = dialog.getByRole("button", { name: "Repository", exact: true });
    await repo.click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(repo).toBeFocused();
    await dialog.getByRole("button", { name: "Create issue", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Create issue", exact: true })).toBeFocused();
  });

  test("submission errors remain in the composer without clearing the draft", async ({ mountApp, page }) => {
    await mountApp({ errors: { create_issue: "No network connection" } });
    await page.getByRole("button", { name: "+ New", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New issue", exact: true });
    await dialog.getByPlaceholder("What needs to be done?").fill("Try this again later");
    await dialog.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("No network connection");
    await expect(dialog.getByPlaceholder("What needs to be done?")).toHaveValue("Try this again later");
    await expect(dialog.getByRole("button", { name: "Create issue", exact: true })).toBeEnabled();
  });

  test("an explicit No Status selection stays unset after reopening", async ({ mountApp, page }) => {
    await mountApp({ createdIssue: makeIssue({ number: 996, title: "Unscheduled issue", node_id: "UNSET_STATUS_996" }) });
    const opener = page.getByRole("button", { name: "+ New", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "New issue", exact: true });
    await dialog.getByRole("button", { name: "Add to project", exact: true }).click();
    await page.getByRole("option", { name: "Roadmap", exact: true }).click();
    await dialog.getByRole("button", { name: "Initial project status", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "No Status", exact: true }).click();
    await dialog.getByPlaceholder("What needs to be done?").fill("Unscheduled issue");
    await dialog.getByRole("button", { name: "Keep draft & go back", exact: true }).click();
    await opener.click();
    await expect(dialog.getByRole("button", { name: "Initial project status", exact: true })).toHaveText(/No Status/);
    await dialog.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __ipcLog: Array<{ cmd: string; args: { statusOptionId?: string | null } }> }).__ipcLog.find((call) => call.cmd === "create_issue_in_project")?.args.statusOptionId)).toBeNull();
  });

  test("a pending request prevents duplicate submission and closing the composer", async ({ mountApp, page }) => {
    await mountApp({ createdIssue: makeIssue({ number: 997, title: "Wait for GitHub", node_id: "PENDING_997" }) });
    await page.evaluate(() => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<unknown> };
        __createCount: number;
        __completeCreate: () => void;
      };
      const invoke = w.__TAURI_INTERNALS__.invoke;
      w.__createCount = 0;
      w.__TAURI_INTERNALS__.invoke = (command, args) => {
        if (command !== "create_issue") return invoke(command, args);
        w.__createCount++;
        return new Promise((resolve) => { w.__completeCreate = () => { void invoke(command, args).then(resolve); }; });
      };
    });
    await page.getByRole("button", { name: "+ New", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New issue", exact: true });
    await dialog.getByPlaceholder("What needs to be done?").fill("Wait for GitHub");
    await dialog.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Creating…", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __createCount: number }).__createCount)).toBe(1);
    await page.evaluate(() => (window as unknown as { __completeCreate: () => void }).__completeCreate());
    await expect(dialog).toHaveCount(0);
  });
});
