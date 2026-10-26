# GitHub Tasks — UI / UX review and design proposal

**Review date:** October 26, 2026 · **Baseline:** v0.6.2 · **Decision status:** approved design implemented locally for testing.

The selected direction keeps the current Projects tab inside the redesign, alongside focused settings pages and reliable action feedback. Expanded Projects keeps the production cards in a flat list; Compact Projects uses single-line items grouped by status. Todos remains a checklist for closing GitHub issues.

The approved direction is now implemented in the application; see [testing instructions](../../UI_TESTING.md). The HTML proposal remains a sample-data reference with simulated actions. The review below records the original findings and design decisions.

### Decisions incorporated in this revision

- Use **Focused pages** for Settings. The proposal now presents this design alone.
- Preserve the production **Projects** cards in **Expanded**: a flat list with the original colored stripes, uppercase status tags, inline metadata, milestones/labels, and hover action tray.
- Group **Compact Projects** by status, with single-line items and colored bucket headings/counts. The sample contains 12 assigned issues, with two or three in every status, so adjacent cards can be judged.
- Give **Todos** a checkbox that asks for confirmation before closing the GitHub issue. Project status changes and issue closure remain separate actions.
- Keep the toolbar **Compact / Expanded** toggle. On Projects, Compact combines single-line items with status grouping; Expanded restores the existing flat card layout. Remember the choice per tab, separately from density and window height.
- Keep sync status and Refresh in the bottom footer, leaving navigation, Settings, and account access across the top. Settings uses the footer for save guidance.
- Give expanded settings areas a clear heading, bounded body, and surface contrast. Advanced subsections remain visually subordinate to their page.

## What was reviewed

The review covers sign-in, first use, Projects, Todos, Inbox, filtering, issue creation, detail/comments, source management, settings, updates, account actions, keyboard behavior, and recovery states.

The baseline screenshots render the **real Svelte frontend with mocked Tauri IPC**. They establish the current layout and navigation, not the behavior of a signed native build or authenticated GitHub session. Code review follows the frontend into the relevant Rust commands where a setting's actual effect matters.

Evidence labels below distinguish **Observed** layout/visible controls in those renders from **Inferred** behavior traced through code. Inferred defects need targeted reproduction during implementation. This is an expert review, not a usability study or an accessibility certification.

### Current screens

| Area | Baseline captures |
|---|---|
| Everyday work | [Projects](current/projects.png), [Todos](current/todos.png), [Inbox](current/inbox.png), [issue detail](current/issue-detail.png) |
| Settings | [General](current/settings-general.png), [General at 480 × 560](current/settings-general-short.png), [Sources](current/settings-sources.png), [add project](current/add-project.png) |
| Entry and account | [Sign-in](current/login.png), [first project](current/empty-projects.png), [new issue](current/new-issue.png), [account menu](current/account-menu.png) |

### What already works

- The tray format makes a short task check quick and keeps GitHub work close at hand.
- Cached lists, streamed project pages, stable ordering, and optimistic creation reduce waiting and list flicker.
- Projects, repository searches, and GitHub notifications serve distinct needs; retain those destinations.
- Inline status changes, linked pull requests, labels, milestones, and comments provide useful context.
- Four density presets respect different reading preferences and board sizes.
- Existing empty states offer a concrete way to add the first project or repository.
- Inbox bulk actions distinguish filtered visible items from the entire GitHub inbox and require confirmation for “mark all.”

## Prioritized findings

**High** means a blocked task, lost work, misleading state, or a major navigation/access problem. **Medium** means recurring friction or weak discoverability. Severity is qualitative; no user analytics or measured completion times are available.

| Priority | Finding and evidence | Proposed response |
|---|---|---|
| High | **Settings content is unreachable in the shorter window.** Observed: the 480 × 560 capture cuts off the lower General options. Inferred: Settings has no scroll container while its containing pane clips overflow. [Settings:256](../../../src/lib/components/Settings.svelte#L256), [App:463](../../../src/App.svelte#L463). | Give settings a bounded, scrollable content area; keep the title and Back reachable. Test every setting at both supported heights. |
| High | **The selected tab can disagree with the screen.** Inferred: tabs and the Settings shortcut update `activeTab` without leaving detail/About; the slider still displays `appView`. [TopBar:61](../../../src/lib/components/TopBar.svelte#L61), [TopBar:98](../../../src/lib/components/TopBar.svelte#L98), [App:393](../../../src/App.svelte#L393). | Every main destination opens its actual screen. Back restores the prior list, filters, and scroll position. |
| High | **Settings can say “Saved” without the promised behavior.** Inferred: the refresh interval is persisted, but the active frontend timer remains fixed at 90 seconds. [Settings:178](../../../src/lib/components/Settings.svelte#L178), [App:371](../../../src/App.svelte#L371). | Rename it “Refresh automatically,” show understandable intervals, and apply changes to the running timer. Preserve the existing custom 30–3600 second range. |
| High | **Draft and modal behavior can lose work.** Inferred: closing New issue resets its draft; Escape closes it unconditionally. The modal declares `aria-modal` without trapping focus or making the background inert. Dropdown Escape can also reach the composer. [NewIssue:243](../../../src/lib/components/NewIssue.svelte#L243), [NewIssue:426](../../../src/lib/components/NewIssue.svelte#L426), [Select:93](../../../src/lib/components/Select.svelte#L93). | Keep the draft on Back; define an explicit discard action. Close the topmost popover first, contain modal focus, and restore focus to the invoking control. |
| High | **Empty and successful states can hide failures.** Inferred: Inbox fetch/load-more errors are console-only; an empty Inbox can claim “Inbox zero” before a successful fetch. Close-issue failures are swallowed; single mark-read failures do not revert. [App:230](../../../src/App.svelte#L230), [App:253](../../../src/App.svelte#L253), [InboxList:151](../../../src/lib/components/InboxList.svelte#L151), [InboxList:386](../../../src/lib/components/InboxList.svelte#L386), [IssueList:124](../../../src/lib/components/IssueList.svelte#L124). | Separate loading, confirmed empty, cached, stale, and failed states. Keep useful cached content visible and provide a local Retry. Roll back rejected actions and explain the failure. |
| High | **Notification settings and attention cues need a coherent contract.** Inferred: Inbox actions always mark GitHub read, while the optional sync setting concerns list indicators. Real Inbox keys use `notif:<thread-id>` but inline list lookups use issue node IDs. Source “Notify on new” is exposed for projects while its command path applies to repo searches. [Settings:218](../../../src/lib/components/Settings.svelte#L218), [inbox.rs:210](../../../src-tauri/src/inbox.rs#L210), [stores:241](../../../src/lib/stores.ts#L241), [ProjectList:589](../../../src/lib/components/ProjectList.svelte#L589), [commands:173](../../../src-tauri/src/commands.rs#L173). | Explain read-status behavior beside its control. Normalize issue/thread association. Separate repository alerts from Inbox alerts; do not display a project alert switch until it has a defined effect. |
| Medium | **The useful in-app reader is secondary to leaving the app.** Observed: title, status, metadata, and small action controls compete. Inferred: titles open GitHub; a secondary chevron opens detail. Projects actions appear only on hover. [ProjectList:608](../../../src/lib/components/ProjectList.svelte#L608), [ProjectList:1116](../../../src/lib/components/ProjectList.svelte#L1116), [IssueList:295](../../../src/lib/components/IssueList.svelte#L295), [InboxList:450](../../../src/lib/components/InboxList.svelte#L450). | The selected Projects direction preserves title → GitHub and the separate in-app view control. Keep status editing distinct and expose the existing action tray on keyboard focus. Title → detail remains an option for the other tabs. |
| Medium | **Source setup asks users to understand internal configuration.** Observed: “Sources,” raw queries, server-side filters, technical project identifiers, and an immediate × removal action. Inferred: removal has no confirmation/undo; a failed delete restores sources without restoring removed result caches. [SourceEditor:182](../../../src/lib/components/SourceEditor.svelte#L182), [SourceEditor:221](../../../src/lib/components/SourceEditor.svelte#L221), [SourceEditor:306](../../../src/lib/components/SourceEditor.svelte#L306), [SourceEditor:345](../../../src/lib/components/SourceEditor.svelte#L345). | Lead with “Projects & repositories,” presets, readable names, and Active/Paused. Put custom syntax and color under More options. Explain that removal affects only this app; offer confirmation or reliable undo. |
| Medium | **Creation starts from the wrong decision.** Inferred: New issue defaults to Project mode, including when no project source exists; the disabled Project tab can remain selected. Todos creation also starts there. [NewIssue:40](../../../src/lib/components/NewIssue.svelte#L40), [NewIssue:293](../../../src/lib/components/NewIssue.svelte#L293), [NewIssue:445](../../../src/lib/components/NewIssue.svelte#L445). | Choose the repository first, then optionally add the issue to a project. Prefill from the current context. Confirm creation with a clear route to the new issue even when filters hide it. |
| Medium | **Filters explain too little when nothing matches.** Observed: different filter treatments across tabs, short “Mine/All” labels, and generic no-match copy. Inferred: saved filters persist; Inbox search/categories inspect loaded items and disable further pagination. [ProjectList:430](../../../src/lib/components/ProjectList.svelte#L430), [ProjectList:577](../../../src/lib/components/ProjectList.svelte#L577), [IssueList:168](../../../src/lib/components/IssueList.svelte#L168), [InboxList:265](../../../src/lib/components/InboxList.svelte#L265). | Preserve the existing Projects filters in the selected direction. Add counts and Clear filters; use clearer assignee wording on the other tabs. Label Inbox search scope and offer loading older notifications while a filter is active. |
| Medium | **Sign-in has no visible recovery after a code fails.** Inferred: polling stops on error but `device` remains set; the sign-in button stays replaced by the existing code screen, without retry/cancel controls. [Login:58](../../../src/lib/components/Login.svelte#L58), [Login:90](../../../src/lib/components/Login.svelte#L90). | Show waiting, expired, denied, and connection-failed states with “Get a new code,” “Open GitHub,” Copy, and Cancel as appropriate. Prevent duplicate start requests. |
| Medium | **Keyboard and visual affordances are uneven.** Observed: settings mixes unrelated controls and calls two equally wide windows “Large/Wide.” Inferred: small status text, hover-only actions, missing selected/expanded states, and reset button styles weaken keyboard use. [Settings:148](../../../src/lib/components/Settings.svelte#L148), [StatusPicker:141](../../../src/lib/components/StatusPicker.svelte#L141), [FilterPicker:57](../../../src/lib/components/FilterPicker.svelte#L57), [InboxList:683](../../../src/lib/components/InboxList.svelte#L683). | Use focused categories, descriptive window heights, readable status text, consistent focus rings, and semantic control states. Keep About, account, release notes, and support easy to locate. |

## Settings direction

### Selected: Focused pages

Add a persistent Settings button beside the main tabs. Open a small settings home with five clearly named destinations; selecting one reveals its own page with Back. This works within the existing 480px width and leaves room for explanations and recovery actions.

| Destination | Existing capabilities to retain | Presentation and proposed refinements |
|---|---|---|
| **Projects & repositories** | Add/edit/remove Project and Repo sources; project/repo picker; source name; enabled state; color; repo presets/query; project item query; source notification preference where supported. | Readable connection rows, Active/Paused state, one Add connection flow. Project board or Repository first; presets before advanced syntax. Keep every current preset, including Open Tasks. Source edits use Save/Cancel. |
| **Appearance** | Both window presets and all four density presets. | Call window presets “Compact height · 560px” and “Full height · 760px,” both 480px wide. Show a live row-density example. Keep these preferences separate from the toolbar's Compact/Expanded card layout. System/light/dark is a separate optional feature, not an existing setting. |
| **Notifications** | OS permission status/link and the needs-response read-sync setting. | Distinguish “Desktop notification permission” from “Mark GitHub notifications read when opening from a task list.” Explain that Inbox Mark read always syncs. Link to per-repository alert settings; clarify project alert support before shipping. |
| **General** | Launch at login; refresh interval; default repository for new issues. | Describe outcomes, show friendly refresh presets with a Custom option, and apply the saved interval. Preferences save automatically with local saving/saved/error feedback. |
| **About & updates** | Current version; automatic/manual update checks; install action; update status and release notes; beta setting; repository/all-releases links; account sign-out; app explanation; developer tools and Quit access. | Group updates and beta explanation together. Include account identity, Report an issue, and release notes. Keep developer tools in Help & diagnostics and Quit in the app/account menu. A copied diagnostic summary would be new behavior. |

A settings home adds a step before a specific preference. Its benefit is a stable location for each task and a shorter page to scan. Preserve direct links from “Add your first project/repository” into the correct form and retain the Settings keyboard shortcut.

Each page needs a visually clear content area. Expanded controls such as More options should sit inside an inset, bounded surface with a distinct summary row; use a clear border and background contrast rather than extra color coding. Keep the page title visible so opening an advanced section does not obscure the current location.

### Saving and explanatory copy

- Preferences save immediately; source editing remains a deliberate Save/Cancel form.
- Place “Saving…,” “Saved,” and “Couldn’t save · Retry” beside the affected setting. Failed changes must not masquerade as persisted preferences.
- Rename “Default repo for new issues” to “Default repository”; explain that creation can override it.
- Rename “Poll interval (seconds)” to “Refresh automatically”; retain precise custom control under the friendly choices.
- Explain pause as “Hide this connection from my task list.” Explain removal as “Remove from GitHub Tasks. Your GitHub items are kept.”
- Beta copy must explain that turning it off takes effect when a newer stable release becomes available; it does not downgrade immediately.

## Whole-app flow recommendations

### Starting and connecting work

After sign-in, guide the user to connect a project board or repository search with a short explanation of each. Inbox can work independently of configured sources; do not make project setup a prerequisite for notifications.

Keep organization/SSO help available at a failed or empty project picker, but lead with a practical next action and Retry. Distinguish an empty list from a failed lookup. Avoid requiring Developer Tools to understand a routine permissions problem.

### Reading and acting on a task

**Expanded Projects keeps the production card.** Use the current flat list, ordered by project status and then update time, without status bucket headers. Preserve the thin 2px status stripe and single-line title with a flat uppercase colored status tag/caret. The next line contains the flat colored PR link, repository, issue number, and update time. A third line contains the milestone and quiet labels. Keep the hover action tray for comment, GitHub, and in-app view; do not add a permanent action footer or spacious rounded panels. Title → GitHub and the separate in-app view control keep their current roles.

**Compact Projects uses status buckets.** Group the single-line items in project status order, with a colored heading and visible item count. Retain each project's configured colors, including the existing stripe and status action. In the sample palette, Backlog is gray, Todo blue, In progress yellow, In review purple, and Done green. Status changes move the item to its destination bucket and update both counts; they do not close the GitHub issue. Unknown or unset status needs its own clearly named bucket. Include multiple sample issues in at least one bucket.

**Todos are a checklist.** Place a checkbox beside the title. Activating it asks “Close this issue?” and explains that confirming closes the issue on GitHub. Cancel or Escape leaves the checkbox unchecked and the issue open. Confirming updates issue state and removes it from the open Todo list; it does not change a project's status field. A failed close keeps the issue visible and gives a recovery action.

For Todos and Inbox, Expanded keeps the preview's detailed card with the title, primary action, repository/number/update time, and optional context. Their title-to-detail behavior remains in the proposal. Projects uses its current card and navigation behavior instead. Keep project status editing distinct from the Todos close checkbox.

The list toolbar provides **Compact / Expanded**. Compact renders one line per item: the title plus essential checkbox or status action, with truncation and an accessible full-title reveal. On Projects, switching to Compact also introduces status bucket headings; switching to Expanded restores the production flat cards and removes those headings. Remember the preference per tab and preserve the current selection, filters, and scroll context when changing layout. This control does not resize the app window or replace the existing padding/type density choices.

Retain all existing metadata and compact density choices. Give linked PR state a text/icon cue alongside color. Avoid pulsing multiple attention signals while the user scans; honor reduced motion for all animation.

Make Back deterministic. Switching a main tab must leave detail or settings and show that destination. Preserve the prior list state where possible. Use one prominent New issue action in the list, rather than competing global and local plus buttons.

### Creating and commenting

Start with a repository and title, with description and optional project association below. Reuse the current repository/project context when available. Keep templates, required template fields, labels, issue type, assignment, and initial project status; progressive disclosure must not remove them.

Retain the draft when navigating away and provide an explicit discard path. Show validation at the relevant field. Disable duplicate submissions, keep failed content, and surface the error near Create or Comment.

On success, offer View issue or open the new detail directly. Explain when the issue exists but falls outside current filters. Inline comment submission needs the same pending/success/failure protections as the detail composer.

### Inbox and sync

Treat notifications as read/unread threads. “Mark read” must mean the same thing every time, including the fact it affects GitHub. Keep read items visible unless Unread only is enabled; distinguish read status from whether an issue or PR is closed.

Keep the existing bulk-scope distinction: under filters, name the visible affected count; without filters, clearly state that the operation covers the entire GitHub inbox. Confirm the broad action and explain that the app cannot undo it.

Show an initial loading state until Inbox has loaded successfully. On failure, retain cached notifications, show the last successful sync, and offer Retry. Do not display “Inbox zero” for a failed fetch.

Search must continue to say it covers loaded notifications. Provide a deliberate way to load older pages under filters and explain when more history remains. Avoid silently replacing a deeply scrolled history view during a refresh.

## Scope boundaries

| Scope | Included ideas | Decision implications |
|---|---|---|
| **Reorganize existing functionality** | Settings categories; persistent Settings access; clearer copy; height naming; scrollable settings; quieter rows; advanced source controls; local save feedback; About/account/support organization. | Can preserve current IPC and persisted values. Needs layout, keyboard, and regression verification. |
| **Change behavior or add functionality** | Honor refresh interval; reliable navigation; normalized notification identities; consistent action rollback; recoverable sign-in; safe source removal; title-to-detail outside Projects; repository-first creation; retained drafts; filtered history loading; status buckets in Compact Projects; per-tab Compact/Expanded card layout. | Requires appropriate frontend/backend tests. Preserve the current Expanded Projects cards and navigation, distinguish project status from GitHub issue state, and define draft lifetime and notification semantics precisely. |
| **Optional appearance expansion** | System, light, and dark themes; additional diagnostic summary tooling. | Separate scope. The current app is dark-only. Themes require all existing components, rendered Markdown, GitHub label colors, popovers, and native chrome to be checked. |

The prototype demonstrates the main settings and task flows. Full template handling, every existing filter, custom refresh intervals, full Inbox history/bulk scope, and native update/auth flows are not implemented in the sample. Those capabilities remain part of the production proposal. External-link and OS actions show a local acknowledgement. The frame expands to make screens inspectable; the production app still needs scrolling at its actual 560px height.

Expanded Projects was visually compared with the production screenshot: compact flat rows, 2px stripes, flat status tags, inline PR metadata, milestones, and labels. Chromium checks passed for the 12-card Expanded list, five Compact buckets with multiple cards, status moves/counts, Mine/All, label search, title-to-GitHub acknowledgement, separate in-app view, and issue closure independent of project status. Both layouts were checked at 320px, 480px, and 736px in light/dark appearance, with no runtime errors or horizontal overflow in those checks. Prototype checks validate the sample's local interactions, not the production application changes below.

## Implementation packages to choose from

| Package | Concrete deliverable | Relative effort / risk |
|---|---|---|
| **Settings foundation** | Fix clipping; implement Focused pages with distinct advanced sections; rename controls; preserve all existing settings/source capabilities; add saving/errors; clarify read-sync and permission copy; wire the real refresh preference; protect source removal. | **Small–medium / low–medium.** Refresh and deletion changes require behavior checks; most work stays within settings. |
| **Everyday workflows and trust** | Production Expanded Projects cards; grouped single-line Compact Projects; Todo close checkboxes/confirmation; per-tab Compact/Expanded card layout; reliable main navigation; title-to-detail outside Projects; consistent filters/empty states; repository-first creation; retained drafts; keyboard/popover/modal behavior; visible action failures; correct Inbox identity and loading/history behavior. | **Medium–large / medium–high.** Crosses stores, IPC contracts, GitHub effects, and navigation. Break into independently reviewable changes around the agreed interaction model. |
| **Visual finish and optional appearance** | Tune hierarchy, typography, action hit areas, status/PR cues, spacing, reduced motion; optionally implement system/light/dark across the complete app and native surfaces. | **Medium / medium**, larger if themes are selected. Themes are independent of the usability fixes and should not delay them. |

The settings structure is selected. Use this revised prototype to refine the card, bucket, and close-confirmation interactions, then decide which implementation package to start. These are relative estimates, not calendar commitments.

## Production acceptance criteria

### Layout and wayfinding

- Every setting and source action is reachable at **480 × 560** and **480 × 760**, including when OS notifications are denied and warning copy expands.
- Long repo/project names, many sources, large counts, empty results, and wrapped text cause no horizontal clipping or trapped controls.
- Main navigation always displays the selected destination; Back restores the intended list context. Settings has an accessible name and a persistent entry point.
- All existing settings, query presets, custom queries, templates, labels, types, assignment, status, metadata, update actions, and support links remain available.
- Expanded settings areas have an obvious heading, boundary, and inset body in light and dark appearance. Nested advanced options remain distinct from page-level content.
- Compact cards remain one line at both supported window heights, retain their essential action, and expose the full title accessibly. Expanded Projects restores the production flat card; Todos and Inbox retain the preview's detailed card. Each tab remembers its layout independently of window height and density.
- Only Compact Projects has status bucket headings. Its buckets retain configured status order and colors, show accurate filtered counts, and move items immediately when status changes. Labels and icons accompany color; unset or unknown status remains visible. Verify with multiple cards in a bucket.
- Expanded Projects matches the production baseline: 2px stripe, truncated title, flat uppercase status/caret, inline colored PR/repository/number/time metadata, milestone/labels, and hover/focus action tray. Title opens GitHub; the separate view control opens in-app detail. Switching layouts preserves all items and status values.

### Truthful state and recovery

- Saved preferences survive relaunch; the running refresh cadence changes when its preference changes. Startup reflects actual OS autostart state.
- A rejected save, close, status update, removal, comment, or mark-read has visible feedback and a recovery path; optimistic UI reconciles correctly.
- A Todo checkbox requests explicit close confirmation. Cancel and Escape leave the issue open and checkbox unchecked. Confirm closes the GitHub issue; failure retains the item and offers retry. Closing an issue never silently changes a project status, and changing project status never silently closes an issue.
- Drafts survive the agreed navigation/close lifecycle. No duplicate issue/comment is sent while a request is pending. Successful creation is findable even outside active filters.
- Inbox loading, confirmed empty, offline/stale, and partial failure are distinct. Association works with real issue IDs and notification thread IDs, not only fixtures.
- Permission help and desktop alert behavior are checked in signed builds on the supported platforms. The macOS System Settings URL is not presented as a universal platform action.
- Stable/beta update copy matches actual forward-only updater behavior; release notes and Report an issue resolve to the intended destinations.

### Keyboard and accessibility

- All actions work with keyboard alone and display visible focus, including row actions. Control names and selected/expanded states are announced correctly.
- If creation stays modal, move focus inside it, contain Tab/Shift+Tab, make the background inert, handle Escape predictably, and restore focus on close. Follow the [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
- Popovers handle Escape before their containing screen; selection and navigation do not strand focus. Text, status, and error cues do not rely on color alone.
- Review pointer targets against the **24 × 24 CSS pixel minimum or documented exceptions**, including spacing; prefer larger hit areas for frequent controls. See [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). This review does not establish compliance.
- Verify actual contrast, zoom/text scaling, screen-reader output, and reduced-motion behavior in both supported window sizes; include both themes only if that feature is selected.

### Verification strategy

Use the existing mocked-IPC Playwright harness for navigation, settings layout, persistence feedback, draft retention, filter resets, modal focus, and rejected-action scenarios. Add checks at the short window height, not just the tall capture size. Compare Expanded Projects against the production screenshot and verify that only Compact has bucket headings. Verify bucket relocation/counts/colors with multiple items, Compact/Expanded persistence per tab, one-line overflow, Todo close cancellation/confirmation/failure, and keyboard focus after a row moves or disappears.

Use unit tests where there is meaningful logic: interval validation, identity association, filter/scope decisions, and draft state. If IPC shapes change, update the matching mock contract. Native permissions, autostart, tray anchoring, keychain/auth, update installation, and real notification identity need a signed-build smoke test; browser mocks cannot verify those integrations.

## Review walkthrough

The proposal now presents the selected **Focused pages** design. Its editable source is [github-tasks-proposal.html](github-tasks-proposal.html).

1. Open Settings and navigate through its focused pages. Expand More options or Help & diagnostics and judge whether the heading and body remain easy to distinguish.
2. Open Projects & repositories. Add a repository, inspect its preset and More options, then edit/pause a connection. Confirm the wording makes the local effect understandable.
3. Open Appearance. Compare window-height labels and density examples. Use the design controls to compare appearance and density; theme support is optional scope.
4. Open Notifications. Compare OS permission status with the GitHub read-status setting. Confirm the difference is clear without knowing the implementation.
5. Open General, then About & updates. Find refresh, startup, default repository, beta updates, account, release notes, and Report an issue.
6. Switch to Projects in Expanded. Compare the flat cards with the production screenshot, including the status tags, inline PR metadata, labels, and hover action tray. Switch to Compact and inspect the colored status buckets with multiple items. Change a status and check relocation/counts, then return to Expanded and confirm that bucket headings disappear while the original card layout returns.
7. Switch to Todos. Try its own Compact/Expanded preference, then use a checkbox to request closing an issue. Cancel once, then confirm on a second attempt. Confirm that this action concerns GitHub issue closure rather than project status.
8. Search/filter the sample lists. On Projects, confirm that the title represents the GitHub action and the separate view control opens detail. On the other tabs, try title-to-detail. Start New issue, type a title/description, go back, and reopen it to inspect draft retention. Create a sample issue and inspect the success destination.
9. Open Inbox, mark a sample notification read, and compare Unread only. The prototype affects sample state only.
10. Use the design controls to inspect **No connections** and **Sync error**, then return to Populated. Compare whether each state explains the next action.

Refine the selected design, then choose the implementation package and optional theme scope. The proposed interaction changes can be accepted independently of the visual styling.
