# UI test build

The approved design is implemented in the Svelte/Tauri app. The HTML proposal remains a sample-data reference.

## Open the macOS build

Quit the currently running GitHub Tasks first, then open:

`src-tauri/target/debug/bundle/macos/GitHub Tasks.app`

The existing copy in `/Applications` has not been replaced. This is a local debug bundle, not a published release. Native window automation could not open the tray window during this session, so OS permissions and notification delivery still need a manual check.

## Try these flows

1. **Projects:** Expanded keeps the existing cards. Compact groups one-line items by each project's status order and colors. Change a status, switch layouts, and relaunch to check the saved layout.
2. **Todos:** the checkbox asks before closing an issue. Cancel or Escape leaves it open. Confirm closes it on GitHub without changing project status.
3. **Settings:** the gear opens five focused pages. Try Compact height, density, custom refresh interval, source presets/advanced queries, pause, and confirmed removal. Preferences save automatically; connection edits use Save/Cancel.
4. **New issue:** choose a repository, enter a draft, optionally add a project, and close/reopen or relaunch. Template form values and labels remain. Discard clears the draft; successful creation provides View issue.
5. **Inbox:** switch Compact/Expanded, filter, load older notifications, and mark a thread read. Mark read always updates GitHub. Opening a task's attention cue clears the local cue; its read-sync preference controls the optional GitHub effect.
6. **Navigation and sync:** the top bar holds navigation, Settings, and your account menu. Sync status and Refresh stay at the bottom while the list scrolls. Settings shows save guidance in that space instead.

Status changes, creating/commenting, closing issues, and Inbox Mark read operate on the connected GitHub account. The automated browser tests use mocked IPC and never change GitHub data.

## Validation

- `npm run check`: no errors or warnings.
- Frontend unit tests: 49 passed.
- Chromium end-to-end tests: 108 passed, including compact-window settings, layouts, action failures, draft restoration, modal keyboard behavior, refresh cadence, stale project pages, and the bottom sync footer.
- Rust tests: 19 passed.
- `cargo clippy --all-targets -- -D warnings`: clean.
- A local macOS debug application bundle was built successfully.

Windows/Linux native builds and OS notification permissions have not been exercised in this session.
