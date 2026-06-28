# Tests

Automated QA for GH Tasks. Two layers, one command.

```bash
npm test            # unit + e2e, the full suite
npm run test:unit   # vitest — pure logic (fast, no browser)
npm run test:e2e    # playwright — the app driven in a headless browser
```

## Why it's built this way

GH Tasks is a **Tauri** app: the Svelte frontend reaches the Rust backend only
through `invoke()` (see [`src/lib/api.ts`](../src/lib/api.ts)). A real Tauri
WebView (WKWebView on macOS) can't be driven by Playwright, and we don't want
tests to need GitHub auth or a network.

So the e2e layer runs the **real Vite-built frontend in Chromium** and installs
a **fake Tauri IPC layer** in the page before the app bundle loads. Every
`invoke`, event (`listen`/`emit`), `getVersion`, and plugin call is answered
from a scripted scenario. The frontend runs completely unmodified — it can't
tell it isn't talking to Rust.

This is the officially-supported seam: Tauri itself ships `mockIPC`
(`@tauri-apps/api/mocks`) built on `window.__TAURI_INTERNALS__`, and our mock
([`tests/e2e/fixtures/tauriMock.ts`](e2e/fixtures/tauriMock.ts)) mirrors it.

## Layout

```
tests/
  unit/                     vitest specs for pure functions (jsdom env)
    issueTemplateForm.test.ts
    markdown.test.ts        rendering + XSS sanitization
    statusColor.test.ts
  e2e/                      playwright specs (Chromium)
    fixtures/
      tauriMock.ts          the injected fake IPC layer (runs in page context)
      mockData.ts           GitHub-shaped fixtures (user, issues, board, …)
      app.ts                the `test`/`mountApp` fixture + default scenario
    smoke.spec.ts           harness boots, signed-in/out
    filtering.spec.ts       text / #number / Mine-All filters
    tabs-and-issues.spec.ts tab nav, Issues tab, persistence
    project-interactions.spec.ts  status change, status/field filters, drill-in
    new-issue.spec.ts       the create-issue modal
    settings-and-detail.spec.ts   settings accordion + issue detail
    auth-and-updates.spec.ts      login screen + update banner
```

## Writing a test

```ts
import { test, expect } from "./fixtures/app";

test("does the thing", async ({ mountApp }) => {
  // mountApp() seeds a full signed-in scenario; override any field.
  const page = await mountApp({ auth: { authenticated: false, user: null } });
  await expect(page.getByRole("button", { name: "Sign in with GitHub" }))
    .toBeVisible();
});
```

The scenario fields (auth, sources, sourceResults, projectPages, settings,
repos, repoLabels, issueDetail, createdIssue, updateCheck, version, …) are typed
in [`tauriMock.ts`](e2e/fixtures/tauriMock.ts) (`Scenario`). Project boards are
delivered the way the app expects — as `project-page` events streamed from
`fetch_all_projects_streaming`.

Need a command the mock doesn't handle yet? Add a `case` in `tauriMock.ts`, or
pass a one-off `overrides: { some_command: value }` in the scenario. Unhandled
commands `console.warn` so a missing mock is obvious.

## CI

`playwright.config.ts` boots `npm run dev` (Vite on :1420) and tears it down.
On CI set `CI=1` for retries + the HTML report. No Rust toolchain needed for
the frontend test suite.
