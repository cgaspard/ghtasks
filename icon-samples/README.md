# Icon samples

Three hand-authored SVG candidates for the GH Tasks app icon. Open each
`.svg` file in a browser (or Finder's Quick Look with space bar) to
preview at any size. They're 1024×1024 flat vector — will scale crisp
down to 16×16 tray size and up to 1024 Dock/Finder icons.

- **[01-checklist-tile.svg](01-checklist-tile.svg)** — three task rows
  in a dark tile, top row with a green check. Clearest "task list"
  read; trademark-safe.
- **[02-branch-check.svg](02-branch-check.svg)** — a simple git-branch
  graphic with a checkmark on the branched node. Minimal; reads as
  "code + done" without literally naming GitHub.
- **[03-clipboard-octocat.svg](03-clipboard-octocat.svg)** — a
  clipboard with a checked task and a small generic cat-face
  silhouette in the corner hinting at the Octocat without copying it.

Pick one (or say "none of these, I'll commission an AI-generated
icon") and we'll convert it to all the required raster sizes
(`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`,
`icon.ico`) and drop them into `src-tauri/icons/`.

For reference: a menu-bar tray icon is a separate monochrome
silhouette; we'll render that by simplifying whichever one you pick
down to a 22×22 stencil.
