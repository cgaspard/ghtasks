import { test, expect } from "./fixtures/app";

test.describe("smoke — harness boots", () => {
  test("signed-in app paints the project board", async ({ mountApp }) => {
    const page = await mountApp();

    // TopBar tabs render once authenticated.
    await expect(
      page.getByRole("button", { name: "Projects", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Issues", exact: true }),
    ).toBeVisible();

    // Streamed project items land on the board.
    await expect(page.getByText("Fix the login flow")).toBeVisible();
    await expect(page.getByText("Refactor the sync engine")).toBeVisible();
  });

  test("signed-out app shows the login screen", async ({ mountApp }) => {
    const page = await mountApp({ auth: { authenticated: false, user: null } });
    await expect(
      page.getByRole("button", { name: "Sign in with GitHub" }),
    ).toBeVisible();
  });
});
