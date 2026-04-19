<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { api, repoFullName, type Issue } from "../api";
  import {
    sourceResults,
    sources,
    visibleIssues,
    selectedSourceIds,
  } from "../stores";

  let filter = $state("");

  const filtered = $derived(
    $visibleIssues.filter(({ issue }) =>
      filter.trim() === ""
        ? true
        : issue.title.toLowerCase().includes(filter.toLowerCase()) ||
          issue.labels.some((l) =>
            l.name.toLowerCase().includes(filter.toLowerCase()),
          ),
    ),
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

  async function complete(issue: Issue) {
    const repo = repoFullName(issue);
    if (!repo) return;
    try {
      await api.toggleIssueState(repo, issue.number, true);
      // Optimistic remove from the local list.
      $sourceResults = $sourceResults.map((r) => ({
        ...r,
        issues: r.issues.filter((i) => i.node_id !== issue.node_id),
      }));
    } catch {
      // leave as-is; next refresh will reconcile.
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
  </div>

  {#if $sources.length > 0}
    <div class="chips">
      <button
        class="chip"
        class:active={$selectedSourceIds.size === 0}
        onclick={clearSelection}>All</button
      >
      {#each $sources.filter((s) => s.enabled) as s (s.id)}
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

  {#if filtered.length === 0}
    <div class="empty">
      {#if $sources.length === 0}
        No sources yet. Add one in the <strong>Sources</strong> tab.
      {:else}
        No issues match.
      {/if}
    </div>
  {:else}
    <ul class="issues">
      {#each filtered as { issue, sourceId } (issue.node_id)}
        {@const src = $sources.find((s) => s.id === sourceId)}
        <li class="issue">
          <button
            class="check"
            title="Close issue"
            onclick={() => complete(issue)}>○</button
          >
          <div class="main">
            <button class="title" onclick={() => open(issue)}>
              {issue.title}
            </button>
            <div class="meta">
              <span class="repo">{repoFullName(issue) || src?.repo || ""}</span>
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
  }
  .filters {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
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
  }
  .issues {
    list-style: none;
    margin: 0;
    padding: 0;
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
</style>
