import { test as base, expect, type Page } from "@playwright/test";
import { TAURI_MOCK_INIT, type Scenario } from "./tauriMock";
import * as data from "./mockData";

/** A complete, signed-in scenario with one repo source + one project board. */
export function defaultScenario(): Scenario {
  return {
    auth: data.AUTHED,
    sources: [data.PROJECT_SOURCE, data.REPO_SOURCE],
    sourceResults: data.SOURCE_RESULTS,
    projectPages: [data.PROJECT_PAGE_EVENT],
    settings: data.SETTINGS,
    projects: [data.PROJECT_SUMMARY],
    repos: [
      {
        id: 1,
        name: "hello-world",
        full_name: "octocat/hello-world",
        private: false,
        html_url: "https://github.com/octocat/hello-world",
        description: "My first repo",
        archived: false,
        open_issues_count: 12,
      },
    ],
    repoLabels: [
      { name: "bug", color: "d73a4a", description: "Something is broken" },
      { name: "enhancement", color: "a2eeef", description: null },
    ],
    issueDetail: {
      issue: data.makeIssue({
        number: 92,
        title: "Fix the login flow",
        body: "The login button does **nothing** on first click.\n\n- [ ] reproduce\n- [x] triage",
        comments: 1,
      }),
      comments: [
        {
          id: 1,
          node_id: "C_1",
          html_url: "https://github.com/octocat/hello-world/issues/92#c1",
          user: { login: "octocat", avatar_url: data.ME.avatar_url },
          body: "I can repro on Safari.",
          created_at: "2026-06-20T13:00:00Z",
          updated_at: "2026-06-20T13:00:00Z",
          author_association: "OWNER",
        },
      ],
    },
    updateCheck: { available: false, version: null, body: null },
    version: "9.9.9-test",
  };
}

type AppFixtures = {
  /** Mount the app with the given scenario (defaults to a full signed-in one). */
  mountApp: (overrides?: Partial<Scenario>) => Promise<Page>;
};

export const test = base.extend<AppFixtures>({
  mountApp: async ({ page }, use) => {
    await use(async (overrides?: Partial<Scenario>) => {
      const scenario: Scenario = { ...defaultScenario(), ...overrides };
      // Seed scenario, then install the mock — both BEFORE the app bundle runs.
      await page.addInitScript(
        (s) => {
          (window as unknown as { __SCENARIO__: unknown }).__SCENARIO__ = s;
        },
        scenario as unknown,
      );
      await page.addInitScript(TAURI_MOCK_INIT);
      await page.goto("/");
      return page;
    });
  },
});

export { expect };
