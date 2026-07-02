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
| Spacious | 3 rows, largest type + most spacing. |

Window size is limited to **Large** and **Wide**.

## Inbox (GitHub notifications mirror)

The **Inbox tab** mirrors github.com/notifications directly — it shows your
actual notification threads (all reasons, read + unread) rather than a curated
subset. Sourced from `GET /notifications`, then:

- **Reasons are classified** into GitHub's inbox filter categories (Review
  requested / Mentioned / Participating / Assigned / Other) for the filter chips.
- **Closed/merged items are filtered out** via a batched GraphQL state check.
- **The tab badge counts UNREAD** notifications (like GitHub's own indicator).
- Filter **chips**: All / Unread / Review requested / Mentioned / Participating
  / Assigned. **Read items are dimmed** but still listed. A per-row **Done**
  clears an item; with the Settings sync toggle on, Done also marks the GitHub
  thread read.

The loud inline cue (amber **gutter dot** + **badge**) on Projects/Issues rows
is gated to **needs-response** items only (review / mention / reply) — not every
inbox notification. A desktop notification fires for new unread needs-response
items.

### (Legacy design notes — the earlier "Awaiting" curation)

The tab began as a curated "Awaiting my response" list. It was reframed to a
direct inbox mirror. Earlier sourcing notes, for reference: `GET /notifications?
participating=true` (threads you're involved in), then:

- **Reasons are mapped** to GitHub's inbox categories: `review_requested`,
  `mention`/`team_mention`, and unread `comment` (a reply) are **needs-response**;
  `assign` is **standing ownership** (its own category). Everything else
  (author, subscribed, ci_activity, state_change, …) is dropped.
- **Closed/merged items are filtered out** via a batched GraphQL state check —
  a notification lingers after its PR closes, so we drop non-open ones.
- **The count badge counts needs-response only** — a pile of assignments never
  spikes it (GitHub separates Assigned from the needs-response filters too).

The **Awaiting tab** has GitHub-style **filter chips** (All / Review requested /
Mentioned / Participating / Assigned), quiet muted reason labels per row, a
per-row **Done** action, and dims **read** items. A **Settings toggle**
(`Sync Awaiting with GitHub notifications`, off by default) makes opening/Done
mark the GitHub thread read so it clears from your real inbox.

The loud inline cue (amber **gutter dot** + **reason badge**) still shows on the
Projects/Issues rows, where awaiting items are the exception. A desktop
notification fires when a new needs-response item appears.

- [app-awaiting-tab.png](app-awaiting-tab.png) — the Awaiting tab + count badge
- [app-awaiting-inline.png](app-awaiting-inline.png) — inline indicator on the Issues tab
- [awaiting-response.html](awaiting-response.html) — the design exploration (all densities, tab, notifications, window sizes)

## Mockups (design exploration)

[row-designs-GxF4-density.html](row-designs-GxF4-density.html) and
[awaiting-response.html](awaiting-response.html) — open in a browser to explore
interactively. The `preset-*.png` / `awaiting-*.png` files are static mockup
renders that preceded the real-app screenshots above.
