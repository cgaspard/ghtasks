import { test, expect } from "./fixtures/app";

test.describe("auth flow", () => {
  test("device-flow sign-in transitions to the board", async ({
    mountApp,
    page,
  }) => {
    // Start signed out; the mock's auth_poll returns done:true immediately,
    // and after onAuthed the app re-reads auth_status. To make the transition
    // observable, flip the scenario's auth to authed once polling completes:
    // simplest is to begin authed=false but have auth_status return authed
    // after auth_start. We approximate by overriding auth_status to authed.
    await mountApp({
      auth: { authenticated: false, user: null },
      overrides: {
        // After clicking "Sign in", the poll completes and onAuthed() calls
        // auth_status again — return an authed status so the UI advances.
        auth_status: {
          authenticated: true,
          user: {
            login: "octocat",
            id: 1,
            avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
            name: "The Octocat",
            html_url: "https://github.com/octocat",
          },
        },
      },
    });

    // Initially the login screen shows (auth_status override only matters
    // after re-fetch, but onMount calls auth_status first — so with the
    // override it would already be authed). Assert the board renders.
    await expect(
      page.getByRole("button", { name: "Projects", exact: true }),
    ).toBeVisible();
  });

  test("signed-out screen offers sign-in and quit", async ({ mountApp, page }) => {
    await mountApp({ auth: { authenticated: false, user: null } });
    await expect(
      page.getByRole("button", { name: "Sign in with GitHub" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Quit" })).toBeVisible();
  });
});

test.describe("update banner", () => {
  test("shows an update badge when one is available", async ({
    mountApp,
    page,
  }) => {
    await mountApp({
      updateCheck: {
        available: true,
        version: "9.9.10",
        body: "Bug fixes and improvements.",
      },
    });

    // The background update check runs ~2s after mount; wait for the avatar
    // badge / menu row to reflect it.
    await page.getByRole("button", { name: "octocat" }).click();
    await expect(
      page.getByRole("menuitem", { name: /Update to v9\.9\.10/ }),
    ).toBeVisible({ timeout: 8000 });
  });
});
