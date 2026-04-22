<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { api, repoFullName, type Issue } from "../api";
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
      if (filter.trim() === "") return true;
      const needle = filter.toLowerCase();
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

  async function open(issue: Issue) {
    await openUrl(issue.html_url);
  }

  function drillIn(issue: Issue) {
    const repo = repoFullName(issue);
    if (!repo) return;
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
      placeholder="Filter…"
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
    <ul class="issues">
      {#each filtered as { issue, sourceId } (issue.node_id)}
        {@const src = $sources.find((s) => s.id === sourceId)}
        <li class="issue" class:confirming={confirmingId === issue.node_id}>
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
            <button
              class="check"
              title="Close issue"
              onclick={() => askClose(issue)}>○</button
            >
            <div class="main">
              <button class="title" onclick={() => open(issue)}>
                {issue.title}
              </button>
              <div class="meta">
                <span class="repo"
                  >{repoFullName(issue) ||
                    (src && src.kind === "repo" ? src.repo : "")}</span
                >
                <span class="num">#{issue.number}</span>
                <span class="time">· {relTime(issue.updated_at)}</span>
                {#each issue.labels.slice(0, 3) as l}
                  <span
                    class="label"
                    style="background:#{l.color}22;border-color:#{l.color};color:#{l.color}"
                    >{l.name}</span
                  >
                {/each}
              </div>
            </div>
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
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .issue:hover {
    background: var(--bg-elev);
  }
  .issue.confirming {
    background: rgba(229, 72, 77, 0.08);
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
  .main {
    flex: 1;
    min-width: 0;
  }
  .title {
    all: unset;
    cursor: pointer;
    display: block;
    color: var(--text);
    line-height: 1.3;
    word-break: break-word;
  }
  .title:hover {
    color: var(--accent);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    align-items: center;
    margin-top: 2px;
    color: var(--text-dim);
    font-size: 11px;
  }
  .label {
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10px;
    border: 1px solid;
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
