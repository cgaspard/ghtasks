import { test, expect } from "./fixtures/app";
import { makeIssue } from "./fixtures/mockData";

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
        window_size: "large",
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
    // Repository-first creation opens with the configured default repository.

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

  test("restoring a form draft keeps its values, labels, and title after templates load", async ({ mountApp, page }) => {
    await mountApp({
      createdIssue: makeIssue({ number: 995, title: "Persistent form issue", node_id: "FORM_995" }),
      issueTemplates: {
        blank_issues_enabled: false,
        templates: [{
          kind: "form", filename: "bug.yml", name: "Bug report", description: "Report a bug", title: "[Bug] ", labels: ["bug"], assignees: ["@me", "maintainer"],
          body: [
            { type: "input", id: "summary", label: "Summary", description: null, placeholder: "What happened?", default_value: "", required: true },
            { type: "checkboxes", id: "checks", label: "Checklist", description: null, options: [{ label: "I searched existing issues", required: true }] },
          ],
        }],
      },
    });
    const opener = page.getByRole("button", { name: "+ New", exact: true });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "New issue", exact: true });
    await expect(dialog.getByRole("button", { name: "Issue template", exact: true })).toHaveText(/Bug report/);
    await dialog.getByPlaceholder("What needs to be done?").fill("Persistent form issue");
    await dialog.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Summary is required");
    await dialog.getByPlaceholder("What happened?").fill("The page will not load");
    await dialog.getByRole("checkbox", { name: /I searched existing issues/ }).check();
    await dialog.locator("summary").filter({ hasText: "Issue options" }).click();
    await dialog.getByRole("button", { name: "Labels", exact: true }).click();
    await dialog.getByRole("dialog", { name: "Labels filters", exact: true }).getByRole("checkbox", { name: "enhancement", exact: true }).check();
    await page.keyboard.press("Escape");
    await dialog.getByRole("button", { name: "Keep draft & go back", exact: true }).click();
    await opener.click();
    await expect(dialog.getByPlaceholder("What happened?")).toHaveValue("The page will not load");
    await expect(dialog.getByRole("checkbox", { name: /I searched existing issues/ })).toBeChecked();
    await page.reload();
    await opener.click();
    await expect(dialog.getByRole("button", { name: "Issue template", exact: true })).toHaveText(/Bug report/);
    await expect(dialog.getByPlaceholder("What needs to be done?")).toHaveValue("Persistent form issue");
    await expect(dialog.getByPlaceholder("What happened?")).toHaveValue("The page will not load");
    await expect(dialog.getByRole("checkbox", { name: /I searched existing issues/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Create issue", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const input = await page.evaluate(() => {
      const call = (window as unknown as { __ipcLog: Array<{ cmd: string; args: { input?: unknown } }> }).__ipcLog.find((entry) => entry.cmd === "create_issue");
      return call?.args.input;
    });
    expect(input).toMatchObject({ title: "Persistent form issue", labels: ["bug", "enhancement"], assignees: ["maintainer", "octocat"] });
    expect((input as { body: string }).body).toContain("### Summary\n\nThe page will not load");
    expect((input as { body: string }).body).toContain("- [X] I searched existing issues");
  });
});
