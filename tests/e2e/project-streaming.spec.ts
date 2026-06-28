import { test, expect } from "./fixtures/app";

// Drives the streamed project-page reconciliation directly via the mock's
// __mockEmit, so we can control page-by-page timing and the is_first/is_final
// flags that the eviction logic in App.svelte keys off of.

const PROJECT = {
  id: "PVT_kwProject1",
  number: 7,
  title: "Roadmap",
  owner_login: "octocat",
  owner_type: "organization",
  url: "https://github.com/orgs/octocat/projects/7",
  closed: false,
};

function item(id: string, num: number, title: string) {
  return {
    item_id: id,
    issue: {
      id: num * 10,
      node_id: `N_${id}`,
      number: num,
      title,
      html_url: `https://example.com/${num}`,
      state: "open",
      labels: [],
      user: null,
      assignees: [{ login: "octocat", avatar_url: "" }],
      repository_url: "https://api.github.com/repos/octocat/hello-world",
      body: null,
      comments: 0,
      updated_at: "2026-06-20T12:00:00Z",
      created_at: "2026-06-19T12:00:00Z",
      pull_request: null,
    },
    repo: "octocat/hello-world",
    field_values: [],
  };
}

function mkPage(items: ReturnType<typeof item>[], is_first: boolean, is_final: boolean) {
  return {
    source_id: "src-proj-1",
    project: PROJECT,
    fields: is_first ? [] : [],
    items,
    is_first,
    is_final,
    error: null,
  };
}

async function emit(page: import("@playwright/test").Page, evt: unknown) {
  await page.evaluate((e) => {
    (window as unknown as { __mockEmit: (n: string, p: unknown) => void }).__mockEmit(
      "project-page",
      e,
    );
  }, evt);
}

test.describe("project streaming reconciliation", () => {
  test("multi-page stream accumulates items; final page keeps all seen items", async ({
    mountApp,
    page,
  }) => {
    // Start with NO auto-streamed pages; we drive them by hand.
    await mountApp({ projectPages: [] });
    await expect(
      page.getByRole("button", { name: "Projects", exact: true }),
    ).toBeVisible();

    // Page 1 of 2 (first, not final).
    await emit(page, page1());
    await expect(page.getByText("Alpha task")).toBeVisible();

    // Page 2 of 2 (final). Both items must survive the final-page prune.
    await emit(page, page2());
    await expect(page.getByText("Alpha task")).toBeVisible();
    await expect(page.getByText("Beta task")).toBeVisible();
  });

  test("final page evicts items not seen in this generation", async ({
    mountApp,
    page,
  }) => {
    await mountApp({ projectPages: [] });
    await expect(
      page.getByRole("button", { name: "Projects", exact: true }),
    ).toBeVisible();

    // First+final page with only Alpha → Beta (never sent) must not appear,
    // and a previously-shown item that's absent from the final gen is dropped.
    await emit(page, mkPage(  [item("I1", 1, "Alpha task"), item("I2", 2, "Beta task")], true, false));
    await expect(page.getByText("Beta task")).toBeVisible();

    // A NEW generation would re-stream; simulate the board shrinking: emit a
    // fresh first+final page (same gen, is_first resets the tracker) that only
    // contains Alpha. Beta should be evicted on the final page.
    await emit(page, mkPage([item("I1", 1, "Alpha task")], true, true));
    await expect(page.getByText("Alpha task")).toBeVisible();
    await expect(page.getByText("Beta task")).toHaveCount(0);
  });
});

function page1() {
  return mkPage([item("I1", 1, "Alpha task")], true, false);
}
function page2() {
  return mkPage([item("I2", 2, "Beta task")], false, true);
}
