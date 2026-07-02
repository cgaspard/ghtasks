<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { api, repoFullName, type Issue } from "../api";
  import LinkedBadges from "./LinkedBadges.svelte";
  import InboxBadge from "./InboxBadge.svelte";
  import {
    sourceResults,
    sources,
    visibleIssues,
    selectedSourceIds,
    showNewIssue,
    loading,
    lastSyncAt,
    auth,
    issuesOnlyMine,
    activeTab,
    settingsSection,
    settingsFocus,
    appView,
    rowDensity,
    inbox,
    inboxByKey,
  } from "../stores";

  let filter = $state("");
  /** node_id of the issue pending close-confirm (null = none). */
  let confirmingId: string | null = $state(null);
  let closing = $state(false);
  const myLogin = $derived($auth.user?.login ?? "");
  const repoSources = $derived(
    $sources.filter((s) => s.kind === "repo"),
  );

  function goAddRepo() {
    settingsFocus.set("new-repo");
    $settingsSection = "sources";
    $activeTab = "settings";
  }

  const filtered = $derived(
    $visibleIssues.filter(({ issue }) => {
      // Assignee filter (Mine toggle).
      if ($issuesOnlyMine && myLogin) {
        const mine = issue.assignees?.some(
          (a) => a.login.toLowerCase() === myLogin.toLowerCase(),
        );
        if (!mine) return false;
      }
      // Text filter.
      const needle = filter.trim().toLowerCase();
      const hashed = needle.startsWith("#");
      const numNeedle = hashed ? needle.slice(1) : needle;
      // A lone "#" (or empty filter) is not a query — show everything.
      if (numNeedle === "" && (needle === "" || hashed)) return true;
      if (/^\d+$/.test(numNeedle)) {
        const num = String(issue.number);
        // "#123" is an explicit, exact issue-number search (and does not fall
        // through to title/label). A bare "123" prefix-matches the number and
        // also still tries title/label below.
        if (hashed) return num === numNeedle;
        if (num.startsWith(numNeedle)) return true;
      }
      return (
        issue.title.toLowerCase().includes(needle) ||
        issue.labels.some((l) => l.name.toLowerCase().includes(needle))
      );
    }),
  );

  const sourceErrors = $derived(
    $sourceResults
      .filter((r) => r.error)
      .map((r) => {
        const name = $sources.find((s) => s.id === r.source_id)?.name ?? r.source_id;
        return { name, error: r.error as string };
      }),
  );

  function toggleSource(id: string) {
    const s = new Set($selectedSourceIds);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    $selectedSourceIds = s;
  }

  function clearSelection() {
    $selectedSourceIds = new Set();
  }

  /** Opening an item marks it seen, clearing its awaiting flag. Optimistically
   * drop it from the local set so the indicator vanishes immediately. */
  function markSeen(issue: Issue) {
    if (!$inboxByKey.has(issue.node_id)) return;
    $inbox = $inbox.filter((a) => a.issue.node_id !== issue.node_id);
    void api
      .markInboxSeen(issue.node_id, new Date().toISOString())
      .catch((e) => console.warn("[ghtasks] mark_inbox_seen failed:", e));
  }

  async function open(issue: Issue) {
    markSeen(issue);
    await openUrl(issue.html_url);
  }

  function drillIn(issue: Issue) {
    const repo = repoFullName(issue);
    if (!repo) return;
    markSeen(issue);
    $appView = {
      kind: "detail",
      repo,
      number: issue.number,
      nodeId: issue.node_id,
    };
  }

  function askClose(issue: Issue) {
    confirmingId = confirmingId === issue.node_id ? null : issue.node_id;
  }
  function cancelClose() {
    confirmingId = null;
  }

  async function confirmClose(issue: Issue) {
    const repo = repoFullName(issue);
    if (!repo) return;
    closing = true;
    try {
      await api.toggleIssueState(repo, issue.number, true);
      // Optimistic remove from the local list.
      $sourceResults = $sourceResults.map((r) => ({
        ...r,
        issues: r.issues.filter((i) => i.node_id !== issue.node_id),
      }));
      confirmingId = null;
    } catch {
      // leave as-is; next refresh will reconcile.
    } finally {
      closing = false;
    }
  }

  function relTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d}d`;
    return new Date(iso).toLocaleDateString();
  }
</script>

<div class="wrap">
  <div class="filters">
    <input
      placeholder="Filter by title, label, or #number…"
      bind:value={filter}
      aria-label="Filter issues"
    />
    <button class="primary small" onclick={() => ($showNewIssue = true)}
      >+ New</button
    >
  </div>

  {#if $sources.length > 0}
    <div class="chips">
      <div class="seg" role="group" aria-label="Assignee filter">
        <button
          class="seg-btn"
          class:active={$issuesOnlyMine}
          onclick={() => ($issuesOnlyMine = true)}
          title="Only issues assigned to me">Mine</button
        >
        <button
          class="seg-btn"
          class:active={!$issuesOnlyMine}
          onclick={() => ($issuesOnlyMine = false)}
          title="Show every issue returned by my sources">All</button
        >
      </div>
      <button
        class="chip"
        class:active={$selectedSourceIds.size === 0}
        onclick={clearSelection}>All sources</button
      >
      {#each $sources.filter((s) => s.enabled && s.kind === "repo") as s (s.id)}
        <button
          class="chip"
          class:active={$selectedSourceIds.has(s.id)}
          onclick={() => toggleSource(s.id)}
          style={s.color ? `--chip: ${s.color}` : ""}
        >
          {s.name}
          <span class="count"
            >{$sourceResults.find((r) => r.source_id === s.id)?.issues
              .length ?? 0}</span
          >
        </button>
      {/each}
    </div>
  {/if}

  {#if sourceErrors.length > 0}
    <div class="src-errors">
      {#each sourceErrors as e}
        <div class="src-error"><strong>{e.name}:</strong> {e.error}</div>
      {/each}
    </div>
  {/if}

  {#if $loading && $lastSyncAt === null}
    <div class="empty">
      <div class="loader" aria-hidden="true"></div>
      <div class="loader-label">Loading issues…</div>
      <div class="loader-hint muted">Fetching from GitHub.</div>
    </div>
  {:else if repoSources.length === 0}
    <div class="empty cta">
      <div class="cta-icon" aria-hidden="true">📬</div>
      <div class="cta-title">Add your first Repository</div>
      <div class="cta-body">
        The Issues tab pulls in open issues across any repo you track —
        with your own search query (defaults to open Tasks). Great for
        watching a repo you don't own, surfacing bugs assigned to you, or
        keeping tabs on PRs awaiting your review.
      </div>
      <button class="primary cta-btn" onclick={goAddRepo}>
        + Add a Repository
      </button>
      <div class="cta-hint muted">
        Looking for board items with Status columns?
        Use the <strong>Projects</strong> tab instead.
      </div>
    </div>
  {:else if filtered.length === 0}
    <div class="empty">
      {#if sourceErrors.length > 0}
        All sources errored. Check the messages above.
      {:else}
        No issues match this query.
      {/if}
    </div>
  {:else}
    <ul class="issues" data-density={$rowDensity}>
      {#each filtered as { issue, sourceId } (issue.node_id)}
        {@const src = $sources.find((s) => s.id === sourceId)}
        {@const inboxItem = $inboxByKey.get(issue.node_id)}
        {@const awaitItem =
          inboxItem &&
          (inboxItem.category === "review_requested" ||
            inboxItem.category === "mentioned" ||
            inboxItem.category === "participating")
            ? inboxItem
            : undefined}
        <li
          class="issue"
          class:confirming={confirmingId === issue.node_id}
          class:awaiting={awaitItem && confirmingId !== issue.node_id}
        >
          {#if confirmingId === issue.node_id}
            <div class="confirm">
              <div class="confirm-prompt">Close this issue?</div>
              <div class="confirm-sub">
                #{issue.number} · {issue.title}
              </div>
              <div class="confirm-actions">
                <button class="ghost small" onclick={cancelClose} disabled={closing}
                  >No</button
                >
                <button
                  class="danger primary small"
                  onclick={() => confirmClose(issue)}
                  disabled={closing}
                >
                  {closing ? "Closing…" : "Yes, close"}
                </button>
              </div>
            </div>
          {:else}
            {#if awaitItem}
              <span class="awaiting-dot" aria-hidden="true"></span>
              <span class="sr">Awaiting your response</span>
            {/if}
            <button
              class="check"
              title="Close issue"
              onclick={() => askClose(issue)}>○</button
            >
            <div class="body">
              <div class="row1">
                {#if awaitItem}<InboxBadge category={awaitItem.category} />{/if}
                <button class="title" onclick={() => open(issue)}>
                  {issue.title}
                </button>
                <button
                  class="drill"
                  title="View issue"
                  aria-label="View issue"
                  onclick={() => drillIn(issue)}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"
                    />
                  </svg>
                </button>
              </div>
              <div class="row2">
                <LinkedBadges {issue} />
                {#if (issue.linked_prs?.length ?? 0) > 0}<span class="sep"
                    >·</span
                  >{/if}
                <span class="repo-num"
                  ><span class="repo"
                    >{repoFullName(issue) ||
                      (src && src.kind === "repo" ? src.repo : "")}</span
                  ><span class="num">#{issue.number}</span></span
                >
                <span class="sep">·</span>
                <span class="time">{relTime(issue.updated_at)}</span>
                {#if issue.labels.length > 0}
                  <span class="sep compact-only">·</span>
                  <span class="row2-labels compact-only"
                    >{issue.labels.map((l) => l.name).join(", ")}</span
                  >
                {/if}
              </div>
              {#if issue.labels.length > 0 || issue.milestone}
                <div class="row3">
                  {#if issue.milestone}
                    <button
                      class="milestone"
                      title={`Milestone: ${issue.milestone.title}`}
                      onclick={() => openUrl(issue.milestone!.url)}
                    >
                      {issue.milestone.title}
                    </button>
                  {/if}
                  {#each issue.labels.slice(0, 6) as l}
                    <span class="label">{l.name}</span>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .filters {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex: 0 0 auto;
  }
  .filters input {
    flex: 1;
  }
  .small {
    font-size: 11px;
    padding: 4px 8px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex: 0 0 auto;
    align-items: center;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-elev);
  }
  .seg-btn {
    all: unset;
    cursor: pointer;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-dim);
  }
  .seg-btn:hover {
    color: var(--text);
  }
  .seg-btn.active {
    background: var(--accent);
    color: white;
  }
  .chip {
    --chip: var(--accent);
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-dim);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .chip:hover {
    color: var(--text);
  }
  .chip.active {
    color: white;
    background: var(--chip);
    border-color: var(--chip);
  }
  .count {
    font-size: 10px;
    opacity: 0.75;
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--text-dim);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex: 1;
    min-height: 0;
  }
  .loader {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    animation: loader-spin 0.8s linear infinite;
  }
  .loader-label {
    color: var(--text);
    font-weight: 500;
    font-size: 13px;
  }
  .loader-hint {
    font-size: 11px;
  }
  .cta {
    padding: 28px 24px;
    gap: 8px;
  }
  .cta-icon {
    font-size: 32px;
    line-height: 1;
    margin-bottom: 2px;
  }
  .cta-title {
    color: var(--text);
    font-weight: 600;
    font-size: 15px;
  }
  .cta-body {
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.5;
    max-width: 320px;
  }
  .cta-btn {
    margin-top: 10px;
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 500;
  }
  .cta-hint {
    font-size: 11px;
    margin-top: 6px;
    max-width: 300px;
    line-height: 1.5;
  }
  @keyframes loader-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .issues {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .issue {
    position: relative;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    border-bottom: 1px solid var(--border);
  }
  .issue:hover {
    background: var(--bg-elev);
  }
  /* ---- awaiting-my-response cue: amber gutter dot + faint left wash ---- */
  .issue.awaiting {
    background-image: linear-gradient(
      90deg,
      rgba(227, 160, 8, 0.1) 0%,
      rgba(227, 160, 8, 0.045) 30%,
      rgba(227, 160, 8, 0) 62%
    );
  }
  .issue.awaiting:hover {
    background-color: var(--bg-elev);
    background-image: linear-gradient(
      90deg,
      rgba(227, 160, 8, 0.14) 0%,
      rgba(227, 160, 8, 0.06) 30%,
      rgba(227, 160, 8, 0) 62%
    );
  }
  .awaiting-dot {
    position: absolute;
    left: 2px;
    top: 12px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #e3a008;
    box-shadow: 0 0 0 3px rgba(227, 160, 8, 0.18);
    animation: awaiting-pulse 2.3s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes awaiting-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 3px rgba(227, 160, 8, 0.18);
    }
    50% {
      box-shadow: 0 0 0 5px rgba(227, 160, 8, 0.04);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .awaiting-dot {
      animation: none;
    }
  }
  .issues[data-density="compact"] :global(.await-badge .lbl) {
    display: none;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .issue.confirming {
    background: rgba(229, 72, 77, 0.08);
    padding: 8px 10px;
  }
  .confirm {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .confirm-prompt {
    font-weight: 500;
    color: var(--text);
  }
  .confirm-sub {
    font-size: 11px;
    color: var(--text-dim);
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.35;
  }
  .confirm-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .danger.primary {
    background: var(--danger);
    border-color: var(--danger);
    color: white;
  }
  .small {
    font-size: 11px;
    padding: 4px 10px;
  }
  .check {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    padding: 0;
    font-size: 13px;
    color: var(--text-dim);
    background: transparent;
    flex: 0 0 auto;
    margin-top: -1px;
  }
  .check:hover {
    color: var(--ok);
    border-color: var(--ok);
  }
  .drill {
    all: unset;
    cursor: pointer;
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-dim);
    flex: 0 0 auto;
    opacity: 0.6;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }
  .issue:hover .drill {
    opacity: 1;
  }
  .drill:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  /* ---- G×F·4 row ---- */
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .row1 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title {
    all: unset;
    cursor: pointer;
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text);
    font-weight: 500;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title:hover {
    color: var(--accent);
  }
  .row2 {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    flex-wrap: nowrap;
    overflow: hidden;
  }
  .row3 {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #aab1bd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sep {
    opacity: 0.45;
    flex: 0 0 auto;
  }
  .repo-num {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .repo {
    opacity: 0.85;
  }
  .num {
    margin-left: 4px;
  }
  .time {
    flex: 0 0 auto;
  }
  .label {
    flex: 0 0 auto;
    color: #aab1bd;
  }
  .milestone {
    all: unset;
    cursor: pointer;
    flex: 0 0 auto;
    color: #8b949e;
  }
  .milestone:hover {
    text-decoration: underline;
  }

  /* ---- density presets ---- */
  .issues[data-density="default"] .issue {
    padding: 9px 12px 9px 4px;
  }
  .issues[data-density="default"] .title {
    font-size: 13.5px;
  }
  .issues[data-density="default"] .row2 {
    font-size: 11px;
    margin-top: 4px;
  }
  .issues[data-density="default"] .row3 {
    font-size: 11px;
    margin-top: 3px;
  }

  .issues[data-density="comfortable"] .issue {
    padding: 11px 12px 11px 6px;
  }
  .issues[data-density="comfortable"] .title {
    font-size: 14px;
  }
  .issues[data-density="comfortable"] .row2 {
    font-size: 11.5px;
    margin-top: 5px;
  }
  .issues[data-density="comfortable"] .row3 {
    font-size: 11.5px;
    margin-top: 4px;
  }

  .issues[data-density="spacious"] .issue {
    padding: 15px 14px 15px 8px;
  }
  .issues[data-density="spacious"] .title {
    font-size: 15.5px;
    line-height: 1.4;
  }
  .issues[data-density="spacious"] .row2 {
    font-size: 12.5px;
    margin-top: 7px;
  }
  .issues[data-density="spacious"] .row3 {
    font-size: 12.5px;
    margin-top: 6px;
  }

  .issues[data-density="compact"] .issue {
    padding: 6px 10px 6px 4px;
  }
  .issues[data-density="compact"] .title {
    font-size: 12.5px;
  }
  .issues[data-density="compact"] .row2 {
    font-size: 10.5px;
    margin-top: 2px;
  }
  .issues[data-density="compact"] .row3 {
    display: none;
  }
  .compact-only {
    display: none;
  }
  .issues[data-density="compact"] .compact-only {
    display: inline;
  }
  .issues[data-density="compact"] .row2-labels {
    color: #aab1bd;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .src-errors {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: rgba(229, 72, 77, 0.08);
  }
  .src-error {
    font-size: 11px;
    color: #ffb4b7;
    line-height: 1.4;
  }
</style>
