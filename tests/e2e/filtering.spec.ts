import { test, expect } from "./fixtures/app";

// The board (from mockData.PROJECT_ITEMS):
//   #92  Fix the login flow        In Progress  P0
//   #101 Add dark mode toggle      Todo         P2
//   #922 Refactor the sync engine  Todo         P1
//   #150 Write onboarding docs     Done
//   #200 Investigate flaky test    (no status)  P1

test.describe("Projects tab — filtering", () => {
  test("number filter matches by issue number prefix", async ({ mountApp }) => {
    const page = await mountApp();
    await expect(page.getByText("Fix the login flow")).toBeVisible();

    const filter = page.getByPlaceholder("Filter by title, label, or #number…");
    await filter.fill("92");

    // "92" should match #92 (prefix) and #922 (prefix), but NOT #101/#150/#200.
    await expect(page.getByText("Fix the login flow")).toBeVisible();
    await expect(page.getByText("Refactor the sync engine")).toBeVisible();
    await expect(page.getByText("Add dark mode toggle")).toHaveCount(0);
    await expect(page.getByText("Write onboarding docs")).toHaveCount(0);
  });

  test("#-prefixed number is an exact issue-number search (no title fallthrough)", async ({
    mountApp,
  }) => {
    const page = await mountApp();
    const filter = page.getByPlaceholder("Filter by title, label, or #number…");

    // #150 → only the Done item, by number.
    await filter.fill("#150");
    await expect(page.getByText("Write onboarding docs")).toBeVisible();
    await expect(page.getByText("Fix the login flow")).toHaveCount(0);

    // "#92" is EXACT: matches #92 but not #922.
    await filter.fill("#92");
    await expect(page.getByText("Fix the login flow")).toBeVisible();
    await expect(page.getByText("Refactor the sync engine")).toHaveCount(0);
  });

  test("bare number also matches titles/labels containing the digits", async ({
    mountApp,
  }) => {
    const page = await mountApp({
      projectPages: [
        {
          source_id: "src-proj-1",
          project: {
            id: "PVT_kwProject1",
            number: 7,
            title: "Roadmap",
            owner_login: "octocat",
            owner_type: "organization",
            url: "https://github.com/orgs/octocat/projects/7",
            closed: false,
          },
          fields: [],
          items: [
            {
              item_id: "ITEM_A",
              issue: {
                id: 10,
                node_id: "N_A",
                number: 1,
                title: "Ship v2 of the dashboard",
                html_url: "https://example.com/1",
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
            },
          ],
          is_first: true,
          is_final: true,
          error: null,
        },
      ],
    });
    await expect(page.getByText("Ship v2 of the dashboard")).toBeVisible();

    // "2" is a bare number: matches #1? no. But title contains "2" (v2) → shown.
    await page.getByPlaceholder("Filter by title, label, or #number…").fill("2");
    await expect(page.getByText("Ship v2 of the dashboard")).toBeVisible();
  });

  test("a lone '#' does not blank the list", async ({ mountApp }) => {
    const page = await mountApp();
    await expect(page.getByText("Fix the login flow")).toBeVisible();

    await page.getByPlaceholder("Filter by title, label, or #number…").fill("#");
    // Falls through to (empty) text search → everything still visible.
    await expect(page.getByText("Fix the login flow")).toBeVisible();
    await expect(page.getByText("Add dark mode toggle")).toBeVisible();
  });

  test("text filter matches title substring", async ({ mountApp }) => {
    const page = await mountApp();
    await page
      .getByPlaceholder("Filter by title, label, or #number…")
      .fill("dark");
    await expect(page.getByText("Add dark mode toggle")).toBeVisible();
    await expect(page.getByText("Fix the login flow")).toHaveCount(0);
  });

  test("Mine/All toggle changes the visible set", async ({ mountApp }) => {
    // One item assigned to someone else; "Mine" should hide it, "All" show it.
    const page = await mountApp({
      projectPages: [
        {
          source_id: "src-proj-1",
          project: {
            id: "PVT_kwProject1",
            number: 7,
            title: "Roadmap",
            owner_login: "octocat",
            owner_type: "organization",
            url: "https://github.com/orgs/octocat/projects/7",
            closed: false,
          },
          fields: [],
          items: [
            mkItem("MINE", 1, "Assigned to me", "octocat"),
            mkItem("THEIRS", 2, "Assigned to someone else", "hubot"),
          ],
          is_first: true,
          is_final: true,
          error: null,
        },
      ],
    });

    // Default is "Mine" → only my item.
    await expect(page.getByText("Assigned to me")).toBeVisible();
    await expect(page.getByText("Assigned to someone else")).toHaveCount(0);

    // Switch to All.
    await page.getByRole("button", { name: "All", exact: true }).first().click();
    await expect(page.getByText("Assigned to someone else")).toBeVisible();
  });
});

function mkItem(id: string, num: number, title: string, assignee: string) {
  return {
    item_id: `ITEM_${id}`,
    issue: {
      id: num * 10,
      node_id: `N_${id}`,
      number: num,
      title,
      html_url: `https://example.com/${num}`,
      state: "open",
      labels: [],
      user: null,
      assignees: [{ login: assignee, avatar_url: "" }],
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
