# AGENTS.md

Orientation for AI coding assistants working in this repo. Humans can read it too — it's also a useful onboarding cheat sheet.

## What this is

**GH Tasks** is a cross-platform menu-bar app that turns GitHub Issues and Projects v2 boards into a fast, keyboard-friendly task list. It lives in the macOS menu bar / Windows & Linux tray and pops open a compact window anchored to the tray icon.

- **Shell:** Tauri 2 (Rust backend + WebView frontend), menu-bar-only (no Dock icon on macOS)
- **Frontend:** Svelte 5 (runes: `$state`, `$derived`, `$effect`) + TypeScript + Vite
- **Backend:** Rust, `reqwest` for HTTP, `keyring` for token storage
- **Auth:** GitHub OAuth **device flow** (no client secret, no backend server)
- **Data:** GitHub GraphQL (Projects v2) + GitHub REST (issue search, comments)

## Repo layout

```
src/                      Svelte frontend
  App.svelte              Top-level shell — refresh loop, stream handler, tab routing
  lib/
    api.ts                Typed wrappers around Tauri `invoke` commands
    stores.ts             Svelte stores (some persisted via persistentStore.ts)
    persistentStore.ts    localStorage-backed writable() helper
    statusColor.ts        GitHub color palette → CSS
    components/
      TopBar.svelte       Tabs (Projects/Issues/Inbox) + avatar menu
      ProjectList.svelte  Projects tab
      IssueList.svelte    Issues tab
      InboxList.svelte     Inbox tab (github.com/notifications mirror)
      InboxBadge.svelte    Amber needs-response cue (inline on Projects/Issues)
      LinkedBadges.svelte Flat colored linked-PR indicator
      Settings.svelte     Settings accordion (Sources / General / About)
      SourceEditor.svelte Add / edit / delete a Project or Repo source
      NewIssue.svelte     Create-issue modal with optional project attach
      Select.svelte       Themed, keyboard-navigable custom dropdown
      StatusPicker.svelte Inline status-change picker for project items
      FilterPicker.svelte Multi-select filter chip popover
      Login.svelte        Device-flow sign-in screen

src-tauri/                Rust backend (Tauri)
  src/
    lib.rs                Tauri builder, plugin wiring, invoke_handler registry
    main.rs               Trivial entrypoint → lib::run()
    commands.rs           All #[tauri::command] entry points
    auth.rs               OAuth device flow + keyring token storage
    github.rs             Shared HTTP client + GraphQL helper
    projects.rs           Projects v2 GraphQL queries & mutations
    inbox.rs              GitHub notification inbox mirror (fetch_inbox + classification)
    sources.rs            Source + Settings persistence + awaiting seen-state (tauri-plugin-store)
    tray.rs               Tray icon + window anchoring + size presets
    notify.rs             Clickable desktop notifications via `user-notify` (native macOS UserNotifications; click → focus + Inbox tab)
    migration.rs           dev.ghtasks.app → com.cgaspard.ghtasks one-shot migration
    http_log.rs           Timing wrapper around reqwest calls (logs `gh-api METHOD path -> status in Nms`)
    error.rs              Shared Result/Error
  tauri.conf.json         App identifier, bundle targets, window config, CSP
  Cargo.toml              `devtools` feature enabled so release builds can open WebView devtools

.github/workflows/
  release.yml             Signed/notarized multi-platform release build

release_notes/            Per-version release body markdown (see Release Process)
  v0.1.6.md
  v0.1.7.md
  v0.1.8.md
  v0.1.9.md
  ...
```

## Identifiers & secrets

- **Bundle identifier:** `com.cgaspard.ghtasks` (legacy `dev.ghtasks.app` is auto-migrated)
- **Keychain service name:** same as bundle identifier
- **OAuth scopes:** `repo read:user read:org notifications project`
- **Client ID:** `GHTASKS_CLIENT_ID` — embedded at build time via `option_env!`; runtime override via env var for dev
- **Apple signing secrets** (GitHub repo secrets, used by `release.yml`):
  - `APPLE_CERTIFICATE` (base64 p12 — must contain **only** the Developer ID Application cert + its matching private key, otherwise `security import` picks the wrong one)
  - `APPLE_CERTIFICATE_PASSWORD`
  - `APPLE_SIGNING_IDENTITY` (e.g. `Developer ID Application: Corey Gaspard (WT7J44YVA3)`)
  - `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), `APPLE_TEAM_ID`

Never log or commit these. Don't regenerate the p12 from the local Keychain without re-exporting only the Developer ID cert.

## Running locally

```bash
# One-time
npm install
rustup target add aarch64-apple-darwin x86_64-apple-darwin   # macOS only, for universal

# Dev (runs Vite + Tauri with hot reload)
npm run tauri dev

# Or use the VS Code launcher "Tauri Dev"
```

`GHTASKS_CLIENT_ID` must be set at build time. A `.env` file at the repo root with `GHTASKS_CLIENT_ID=Ov23lihPJQFjJ3eZd0Zc` works for local dev.

## Testing

```bash
npm test            # full suite: unit (vitest) + e2e (playwright)
npm run test:unit   # pure-logic unit tests, no browser
npm run test:e2e    # frontend driven in headless Chromium
```

The e2e suite runs the **real Svelte frontend in Chromium with a mocked Tauri
IPC layer** — no Rust, no GitHub auth, no network. The mock
([tests/e2e/fixtures/tauriMock.ts](tests/e2e/fixtures/tauriMock.ts)) installs
`window.__TAURI_INTERNALS__` before the bundle loads and answers every
`invoke`/event/plugin call from a scripted scenario; the frontend runs
unmodified. See [tests/README.md](tests/README.md) for how to write a test and
add a scenario. A Tauri WebView can't be driven by Playwright directly, which is
why we mock at the IPC seam rather than spinning up `tauri-driver`.

When you change an `invoke` command's shape in `src/lib/api.ts`, update the
matching `case` (and `Scenario` type) in `tauriMock.ts` so the e2e suite stays
in sync with the IPC contract.

## Code conventions

- **TypeScript:** strict mode. Prefer `$derived` over recomputed assignments. Named exports only.
- **Rust:** clippy-clean on `cargo clippy --all-targets`. Wrap all GitHub HTTP calls in `http_log::send_timed` so timings show up in logs.
- **GraphQL queries:** keep them inline in the relevant Rust module as `const … : &str`. Avoid `orderBy:` on `projectsV2` connections — it has silently null'd the `organizations` branch for certain org roles; sort client-side instead.
- **Stores:** anything the user would expect to persist across relaunches should use `persistent()` from `lib/persistentStore.ts`. Transient UI state stays in plain `writable()`.
- **CSP:** `tauri.conf.json` → `security.csp`. If a Tauri plugin's IPC is blocked, add `ipc:` / `http://ipc.localhost` to `connect-src` (not `default-src`).
- **No trailing summaries in responses.** Terse over verbose. Don't restate what a well-named symbol already says.
- **No premature abstractions.** Three similar lines beat a bad base class.

## The refresh loop (important mental model)

`App.svelte::refresh()` is the heartbeat:

1. Bumps `refreshGeneration`. Any late-arriving data (streamed project pages) tagged with a stale generation is dropped.
2. In parallel:
   - `api.fetchAll()` — REST issue-search for all enabled repo sources, returns all results at once
   - `api.fetchAllProjectsStreaming()` — fires `project-page` events as each GraphQL page lands; `App.svelte` reconciles them into `$projectResults`
3. Reconciliation is additive: items are upserted by `item_id`. On the **final** page of a generation, items not seen this generation are dropped (archived/removed upstream), except those in the `recentlyCreated` buffer (2-min TTL) — GitHub Search and Projects indexing lags ~60s behind creates, so we keep recently-created issues visible until the server catches up.
4. Results are persisted to `localStorage` via `persistent()` so the next cold launch paints instantly from cache while a fresh sync runs underneath.

Auto-poll every 90s. Manual refresh via the ↻ button in TopBar.

## Performance notes (earned, not guessed)

- Current full-snapshot fetch of a 500-item board: ~4s on refresh, ~8.6s cold.
- Key wins: server-side `-status:Released` default filter, disk-cache hydrate, parallel-cursor pagination on subsequent refreshes.
- REST + ETag optimization was researched and rejected: REST `projects/.../items?fields=` needs numeric field IDs that don't map cheaply from our GraphQL `id`s, and we'd have to maintain two parallel shape representations. Don't revive it without a concrete benchmark.

## Common diagnostics

- **"I can't see project X":** Open avatar menu → **Developer Tools** → Console. Click `+ Project`. Look for `[ghtasks] list_projects returned N project(s)` and the array. If `0` or missing an expected project, it's almost always: (1) org hasn't approved the OAuth app, (2) SSO not authorized for the token, or (3) stale token from before `read:org` was added — sign out + sign in fixes the last.
- **Notifications silent / not clickable in dev:** Expected. `notify.rs` uses `user-notify` (native macOS `UserNotifications`), which **only fires from a signed, bundled `.app`**. An unbundled `npm run tauri dev` binary has no Bundle ID, so the crate silently returns an in-memory **mock** that logs (`notify: …`) but shows nothing. To see/click real notifications, run a `tauri build` release. A clicked notification calls `tray::show_at_tray` and emits `open-inbox-item` (node_id payload); `App.svelte` listens and switches to the Inbox tab. (This replaced `tauri-plugin-notification`, whose desktop path couldn't react to clicks — so the old `ipc:` CSP note no longer applies to notifications.)
- **Issue "disappeared" right after creating it:** Expected for ~60s; the `recentlyCreated` buffer re-injects it. If it persists beyond 2 min, something else is wrong — check the refresh logs.

## Release Process

Releases are driven entirely by pushing a `vX.Y.Z` tag. The workflow at [.github/workflows/release.yml](.github/workflows/release.yml) builds signed/notarized artifacts for macOS / Windows / Linux and attaches them to a **draft** GitHub release, using the body pulled from `release_notes/<tag>.md`.

### Per-version release notes (required)

Every tag **must** have a matching `release_notes/<tag>.md` file, or the build fails in the `preflight` job before any compile work starts. This is intentional — it means the release body is version-controlled, reviewable in PRs, and available for historical reference long after the release ships.

- File path: `release_notes/vX.Y.Z.md`
- Contents: markdown. Section headers like `### Fixes`, `### New`, `### Install` are conventional but not required.
- Must be non-empty.

### Cutting a release (step by step)

1. **Pick the version.** Semver. Bump patch for fixes, minor for features.
2. **Write the release notes.** Create `release_notes/vX.Y.Z.md`. Describe changes in user-visible terms — "why would someone care?" not "what files changed." Cover fixes, new features, known issues, and install/upgrade instructions.
3. **Bump versions in code:**
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `[package] version`
   - `package.json` → `version`
4. **Commit.** Conventional subject, e.g. `Release v0.1.9 — notification CSP + empty-state CTAs`.
5. **Tag and push:**
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
6. **Watch the workflow.** `gh run watch` or GitHub Actions UI. On success the release is **auto-published** (no draft step) with:
   - `GH.Tasks_universal.dmg` (signed + notarized)
   - `GH.Tasks_x64-setup.exe`, `GH.Tasks_x64_en-US.msi`
   - `GH.Tasks_amd64.AppImage`, `GH.Tasks_amd64.deb`, `GH.Tasks-<v>-1.x86_64.rpm`
   - `latest.json` (the auto-updater manifest)
7. **Spot-check the artifacts.** Download the DMG, install, verify no Gatekeeper warning, sign-in works, projects load. Since stable auto-publishes, watchers are notified immediately — if you want a pre-flight check first, ship a **beta** (below) and dogfood it before the stable tag.

### Release channels: stable vs beta

The app has an in-app **beta channel** (Settings → General → *Receive beta updates*). The updater picks its endpoint from the `beta_updates` setting ([commands.rs](src-tauri/src/commands.rs) `channel_updater`):

- **stable** → `releases/latest/download/latest.json` (GitHub's `/latest/` excludes pre-releases)
- **beta** → `releases/download/beta/latest-beta.json` (a permanent pre-release tagged `beta` whose manifest CI refreshes)

**Cutting a beta:** tag it with a pre-release suffix — `vX.Y.Z-beta.N` (the hyphen is what flags it). Same rules otherwise: it needs `release_notes/vX.Y.Z-beta.N.md`. CI then:
1. Builds + **auto-publishes it as a GitHub pre-release** (stable users' updater never sees it — `/releases/latest` excludes pre-releases).
2. Runs `refresh-beta-channel`, copying that build's `latest.json` onto the permanent `beta` release as `latest-beta.json`. Beta users auto-update to it within a poll cycle.

**Promoting a beta to production:** there is no "convert" step — you cut a normal stable tag with the release version:

```bash
git tag v0.6.0-beta.1 && git push origin main --tags   # dogfood on the beta channel
git tag v0.6.0-beta.2 && git push origin main --tags   # ...iterate...
git tag v0.6.0        && git push origin main --tags   # promote to production
```

The stable tag converges *both* audiences onto the production build:
- **Stable users** — `/releases/latest` flips to `v0.6.0`; they update on their next poll.
- **Beta users** — `refresh-beta-channel` also runs for stable tags, so it repoints `latest-beta.json` at `v0.6.0`. Beta users see it on *their* endpoint and update immediately — no one lingers on `v0.6.0-beta.2`. (This is belt-and-suspenders on top of semver, which already ranks `0.6.0 > 0.6.0-beta.2`.)

The updater only ever moves *forward* (`release.version > current_version`), so refreshing the beta manifest to a stable build never downgrades anyone.

Don't delete the permanent `beta` release or retag `beta` by hand — CI owns it. It's a pre-release on purpose so it never becomes `/releases/latest`.

### If something goes wrong

- **`preflight` job fails with "Missing release notes":** you forgot `release_notes/<tag>.md`. Add the file, commit, delete the tag locally and remotely, re-tag, push.
- **macOS signing fails with `security import: failed to import keychain certificate`:** the p12 likely contains multiple certs. Re-export just the **Developer ID Application** cert + its matching private key from Keychain as a fresh p12 and update the `APPLE_CERTIFICATE` secret.
- **Workflow runs for 0s and shows "startup_failure":** check that step-level `if:` expressions don't reference `secrets.*` directly (they're not available there). Use the job-level `env.HAS_APPLE_CERT` pattern.
- **Release has wrong notes:** edit `release_notes/vX.Y.Z.md` in main, then `gh release edit vX.Y.Z --notes-file release_notes/vX.Y.Z.md`. (The build-time copy is a snapshot; the file is the source of truth.)

### Never

- Never push a tag that doesn't have a `release_notes/<tag>.md` (the preflight will block you, but don't rely on it — if someone disables the check, the release body falls back to nothing).
- Never force-push to `main`. Never force-delete a published release's tag — it breaks `Sparkle`/auto-update semantics if we ever add them.
- Never commit `.env`, `*.p12`, or any file that contains `APPLE_*` or `GHTASKS_CLIENT_ID` values. `.gitignore` covers the common ones; double-check before `git add`.

## Things agents commonly get wrong here

- **Inventing comments.** Don't explain what `const myLogin = $derived($auth.user?.login ?? "")` does — it's self-explanatory. Save comments for the non-obvious *why*.
- **Adding backwards-compat shims.** We ship a menu-bar app, not a library. If a type or function is unused after a change, delete it.
- **Adding `orderBy: {field: TITLE}` to `projectsV2` GraphQL queries.** Don't. See conventions above.
- **Using native `<select>`.** Use the themed `Select.svelte` component. It exists for good reason.
- **Skipping the release notes file** "since the build will just generate something." It won't anymore — preflight will fail.
