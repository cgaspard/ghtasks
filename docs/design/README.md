# Row design — GH Tasks list rows

The list-row design (“G×F·4”) and its three density presets.

## Real-app renders

Captured from the actual Svelte frontend (via the e2e harness):

| Preset | Projects tab | Issues tab |
|---|---|---|
| Compact | [app-projects-compact.png](app-projects-compact.png) | — |
| Default | [app-projects-default.png](app-projects-default.png) | [app-issues-default.png](app-issues-default.png) |
| Comfortable | [app-projects-comfortable.png](app-projects-comfortable.png) | — |

## The design

Each row:

- **Line 1** — title (truncates) + uppercase status tag (color-coded, no pill).
  Clicking the status tag opens the status picker (Projects tab).
- **Line 2** — flat colored linked-PR (green = open, purple = merged, red =
  closed, grey = draft) · repo · `#num` · time.
- **Line 3** — milestone pill + labels (quiet text).

A thin 2px status-color stripe runs down the left edge. The linked PR is colored
text (no pill) so it stands out by color alone, at near-equal weight to status.

## Density presets

User-selectable in **Settings → General** (default = Default):

| Preset | Layout |
|---|---|
| Compact | 2 rows; labels fold inline onto line 2, truncated. Densest. |
| Default | 3 rows; line 2 never wraps, labels on line 3. |
| Comfortable | 3 rows, same structure, larger type + more padding. |

## Mockup (design exploration)

[row-designs-GxF4-density.html](row-designs-GxF4-density.html) — open in a
browser to see all density steps interactively. The `preset-*.png` files are the
static mockup renders that preceded the real-app screenshots above.
