<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { api, repoFullName, type InboxItem, type Issue } from "../api";
  import { inbox, rowDensity, appView } from "../stores";
  import LinkedBadges from "./LinkedBadges.svelte";

  // Quiet muted reason label per row — maps raw GitHub reasons to friendly text.
  function reasonLabel(reason: string): string {
    switch (reason) {
      case "review_requested":
        return "review requested";
      case "mention":
      case "team_mention":
        return "mentioned you";
      case "comment":
        return "new reply";
      case "assign":
        return "assigned to you";
      case "author":
        return "your thread";
      case "subscribed":
        return "subscribed";
      case "ci_activity":
        return "CI activity";
      case "state_change":
        return "state changed";
      case "manual":
        return "subscribed";
      default:
        return reason.replace(/_/g, " ");
    }
  }

  // Filter chips mirror github.com/notifications default filters, plus Unread.
  type Chip =
    | "all"
    | "unread"
    | "review_requested"
    | "mentioned"
    | "participating"
    | "assigned";
  let chip: Chip = $state("all");

  function inChip(item: InboxItem, c: Chip): boolean {
    switch (c) {
      case "all":
        return true;
      case "unread":
        return item.unread;
      case "review_requested":
        return item.category === "review_requested";
      case "mentioned":
        return item.category === "mentioned";
      case "participating":
        return item.category === "participating";
      case "assigned":
        return item.category === "assigned";
    }
  }

  const counts = $derived({
    all: $inbox.length,
    unread: $inbox.filter((i) => i.unread).length,
    review_requested: $inbox.filter((i) => inChip(i, "review_requested")).length,
    mentioned: $inbox.filter((i) => inChip(i, "mentioned")).length,
    participating: $inbox.filter((i) => inChip(i, "participating")).length,
    assigned: $inbox.filter((i) => inChip(i, "assigned")).length,
  });
  const CHIPS: { key: Chip; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "review_requested", label: "Review requested" },
    { key: "mentioned", label: "Mentioned" },
    { key: "participating", label: "Participating" },
    { key: "assigned", label: "Assigned" },
  ];

  const filtered = $derived($inbox.filter((i) => inChip(i, chip)));

  function relTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  /** Mark an item Done — remove from the list (optimistically) + persist. Syncs
   * to GitHub (mark thread read) when the sync setting is on, handled backend
   * side in mark_inbox_seen. */
  function markSeen(issue: Issue) {
    $inbox = $inbox.filter((i) => i.issue.node_id !== issue.node_id);
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
</script>

<div class="wrap">
  {#if $inbox.length > 0}
    <div class="chips" role="tablist" aria-label="Filter">
      {#each CHIPS as c}
        <button
          class="chip"
          class:active={chip === c.key}
          role="tab"
          aria-selected={chip === c.key}
          onclick={() => (chip = c.key)}
        >
          {c.label}
          {#if counts[c.key] > 0}<span class="chip-count">{counts[c.key]}</span
            >{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if $inbox.length === 0}
    <div class="empty">
      <div class="empty-icon">✓</div>
      <div class="empty-title">Inbox zero</div>
      <div class="empty-body">
        No notifications right now. Review requests, mentions, replies, and
        assignments will show up here.
      </div>
    </div>
  {:else if filtered.length === 0}
    <div class="empty">
      <div class="empty-title">Nothing here</div>
      <div class="empty-body">No items match this filter.</div>
    </div>
  {:else}
    <ul class="issues" data-density={$rowDensity}>
      {#each filtered as item (item.issue.node_id)}
        <li class="issue" class:read={!item.unread}>
          <div class="body">
            <div class="row1">
              <button class="title" onclick={() => open(item.issue)}>
                {item.issue.title}
              </button>
              <span class="reason">{reasonLabel(item.reason)}</span>
              <button
                class="act"
                title="Done — clear from this list"
                aria-label="Mark done"
                onclick={() => markSeen(item.issue)}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z"
                  />
                </svg>
              </button>
              <button
                class="drill"
                title="View on GitHub"
                aria-label="View on GitHub"
                onclick={() => drillIn(item.issue)}
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
              <LinkedBadges issue={item.issue} />
              {#if (item.issue.linked_prs?.length ?? 0) > 0}<span class="sep"
                  >·</span
                >{/if}
              <span class="repo-num"
                >{repoFullName(item.issue) ?? ""}<span class="num"
                  >#{item.issue.number}</span
                ></span
              >
              <span class="sep">·</span>
              <span class="time">{relTime(item.event_at)}</span>
              {#if item.issue.milestone}
                <span class="sep">·</span>
                <button
                  class="milestone"
                  title={`Milestone: ${item.issue.milestone.title}`}
                  onclick={() => openUrl(item.issue.milestone!.url)}
                >
                  {item.issue.milestone.title}
                </button>
              {/if}
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
    min-height: 0;
  }
  .chips {
    display: flex;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex: 0 0 auto;
    overflow-x: auto;
  }
  .chip {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }
  .chip:hover {
    color: var(--text);
  }
  .chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .chip-count {
    font-size: 10px;
    font-weight: 700;
    opacity: 0.85;
  }
  .act {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-dim);
    flex: 0 0 auto;
    opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }
  .issue:hover .act {
    opacity: 0.7;
  }
  .act:hover {
    opacity: 1;
    background: rgba(46, 160, 67, 0.15);
    color: #3fb950;
  }
  /* Read items (already seen on GitHub) are dimmed but still listed. */
  .issue.read .title {
    color: var(--text-dim);
    font-weight: 400;
  }
  .issue.read .reason {
    opacity: 0.7;
  }
  .issues {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  /* Calm rows — the whole tab is "awaiting", so no per-row amber cue. The
     reason reads as a quiet muted label instead. */
  .issue {
    position: relative;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    border-bottom: 1px solid var(--border);
  }
  .issue:hover {
    background-color: var(--bg-elev);
  }
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
  .reason {
    flex: 0 0 auto;
    font-size: 10.5px;
    color: var(--text-dim);
    white-space: nowrap;
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
  .drill {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-dim);
    flex: 0 0 auto;
    opacity: 0.6;
  }
  .issue:hover .drill {
    opacity: 1;
  }
  .drill:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .row2 {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    flex-wrap: nowrap;
    overflow: hidden;
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
    opacity: 0.85;
  }
  .num {
    margin-left: 4px;
  }
  .time {
    flex: 0 0 auto;
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
  .issues[data-density="compact"] .issue {
    padding: 6px 12px;
  }
  .issues[data-density="compact"] .title {
    font-size: 12.5px;
  }
  .issues[data-density="compact"] .row2 {
    font-size: 10.5px;
    margin-top: 2px;
  }
  .issues[data-density="compact"] .reason {
    font-size: 9.5px;
  }
  .issues[data-density="default"] .issue {
    padding: 9px 14px;
  }
  .issues[data-density="default"] .title {
    font-size: 13.5px;
  }
  .issues[data-density="default"] .row2 {
    font-size: 11px;
    margin-top: 4px;
  }
  .issues[data-density="comfortable"] .issue {
    padding: 11px 15px;
  }
  .issues[data-density="comfortable"] .title {
    font-size: 14px;
  }
  .issues[data-density="comfortable"] .row2 {
    font-size: 11.5px;
    margin-top: 5px;
  }
  .issues[data-density="spacious"] .issue {
    padding: 15px 18px;
  }
  .issues[data-density="spacious"] .title {
    font-size: 15.5px;
    line-height: 1.4;
  }
  .issues[data-density="spacious"] .row2 {
    font-size: 12.5px;
    margin-top: 7px;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 8px;
    padding: 32px 24px;
  }
  .empty-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(46, 160, 67, 0.15);
    color: #3fb950;
    font-size: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .empty-title {
    color: var(--text);
    font-weight: 600;
    font-size: 15px;
  }
  .empty-body {
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.5;
    max-width: 300px;
  }
</style>
