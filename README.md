# GH Tasks

A menu-bar issue dashboard that treats GitHub Issues as your personal task list.
Define **Sources** — each a `(repo, GitHub search query)` pair — and the app
surfaces every matching issue in one unified list. Works across multiple repos
so one app can drive your personal todos, work tasks, and PR review queue.

- macOS menu bar + Windows system tray (Tauri 2)
- GitHub Device Flow auth — no client secret shipped, token in OS keychain
- Multi-repo Sources with per-Source enable/notify/color
- Native filters via GitHub search syntax (including the new issue types)
- Create / complete / open issues inline
- Desktop notifications when new matching issues appear
- Mobile (iOS/Android) via Tauri mobile — planned
- Real-time via a GitHub App webhook relay — planned

## Develop

Requirements: Node 20+, Rust 1.77+, plus the Tauri system deps for your OS:
<https://tauri.app/start/prerequisites/>.

```sh
npm install
npm run tauri dev
```

Before building installers for the first time, set your OAuth client id:

```sh
export GHTASKS_CLIENT_ID=Iv1.xxxxxxxxxxxxxxxx
```

(Any public GitHub App or OAuth app's client id works — device flow is
designed to be safe to embed.)

## Build

```sh
npm run tauri build
```

Artifacts land in `src-tauri/target/release/bundle/`.

## Project layout

```
src/                    Svelte frontend
  lib/api.ts            Typed wrapper around Tauri commands
  lib/stores.ts         Svelte stores (auth, sources, issues)
  lib/components/       UI components
src-tauri/src/
  auth.rs               Device flow + keychain
  github.rs             GitHub REST client
  sources.rs            Source + Settings persistence
  commands.rs           Tauri command surface
  tray.rs               Menu bar / system tray
  notify.rs             Native notifications
  lib.rs                App entry + plugin wiring
```
