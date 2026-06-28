import { test, expect } from "./fixtures/app";
import { makeIssue } from "./fixtures/mockData";

test.describe("New Issue modal", () => {
  test("opens from the + New button and closes on Cancel", async ({
    mountApp,
    page,
  }) => {
    await mountApp();
    await page.getByRole("button", { name: "+ New" }).click();

    const dialog = page.getByRole("dialog", { name: "New issue" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
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
    await page.getByRole("button", { name: "Issues", exact: true }).click();
    await page.getByRole("button", { name: "+ New" }).click();
    const dialog = page.getByRole("dialog", { name: "New issue" });

    // Switch to "Repo only" mode so it uses create_issue.
    await dialog.getByRole("button", { name: "Repo only" }).click();
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
});
