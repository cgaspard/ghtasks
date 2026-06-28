import { test, expect } from "./fixtures/app";

// Two repos, each with a distinct markdown template. Switching repos must
// reset the body "touched" flag so a newly-picked template applies its body
// (regression: a prior body edit used to suppress template application after
// a repo change).
const TWO_REPOS = [
  {
    id: 1,
    name: "hello-world",
    full_name: "octocat/hello-world",
    private: false,
    html_url: "https://github.com/octocat/hello-world",
    description: "first",
    archived: false,
    open_issues_count: 1,
  },
  {
    id: 2,
    name: "spoon-knife",
    full_name: "octocat/spoon-knife",
    private: false,
    html_url: "https://github.com/octocat/spoon-knife",
    description: "second",
    archived: false,
    open_issues_count: 1,
  },
];

function markdownTemplate(filename: string, name: string, body: string) {
  return {
    kind: "markdown",
    filename,
    name,
    about: "An example template",
    title: null,
    labels: [],
    assignees: [],
    body,
  };
}

/** The custom <Select> used for the Template field renders as `button.trigger`
 * whose visible text is the current label. Locate it by that label. */
function selectTrigger(
  dialog: ReturnType<import("@playwright/test").Page["getByRole"]>,
  currentLabel: RegExp,
) {
  return dialog.locator("button.trigger").filter({ hasText: currentLabel });
}

test.describe("New Issue — template application across repo switch", () => {
  test("editing body then switching repo lets the new template re-apply", async ({
    mountApp,
    page,
  }) => {
    await mountApp({
      repos: TWO_REPOS,
      settings: {
        default_repo: "octocat/hello-world",
        poll_interval_secs: 90,
        launch_at_login: false,
        window_size: "default",
      },
      issueTemplatesByRepo: {
        "octocat/hello-world": {
          templates: [markdownTemplate("a.md", "Repo A bug", "BODY FROM REPO A TEMPLATE")],
          blank_issues_enabled: true,
        },
        "octocat/spoon-knife": {
          templates: [markdownTemplate("b.md", "Repo B bug", "BODY FROM REPO B TEMPLATE")],
          blank_issues_enabled: true,
        },
      },
    });

    await page.getByRole("button", { name: "+ New" }).click();
    const dialog = page.getByRole("dialog", { name: "New issue" });
    // Repo-only mode keeps the form simple (no project picker). Modal opens
    // already defaulted to repo A via default_repo.
    await dialog.getByRole("button", { name: "Repo only" }).click();

    const bodyField = dialog.getByPlaceholder("Notes, checklist…");

    // Sanity: repo A's template applies its body when picked fresh.
    await selectTrigger(dialog, /Blank \(no template\)/).click();
    await page.getByRole("option", { name: "Repo A bug" }).click();
    await expect(bodyField).toHaveValue("BODY FROM REPO A TEMPLATE");

    // 1) Hand-edit the body (sets bodyTouched = true).
    await bodyField.fill("my own hand-typed notes");
    await expect(bodyField).toHaveValue("my own hand-typed notes");

    // 2) Switch repo to spoon-knife. This must reset the touched flag.
    await selectTrigger(dialog, /octocat\/hello-world/).click();
    await page.getByRole("option", { name: /spoon-knife/ }).click();

    // 3) Pick repo B's template. Its body should now apply cleanly despite the
    //    earlier hand-edit (regression guard for the touched-flag reset).
    await selectTrigger(dialog, /Blank \(no template\)/).click();
    await page.getByRole("option", { name: "Repo B bug" }).click();
    await expect(bodyField).toHaveValue("BODY FROM REPO B TEMPLATE");
  });
});
