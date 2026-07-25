<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import {
    api,
    repoFullName,
    type InboxCategory,
    type InboxItem,
    type Issue,
  } from "../api";
  import {
    inbox,
    rowDensity,
    appView,
    inboxHasMore,
    inboxLoadingMore,
    inboxCategoryFilters,
    inboxUnreadOnly,
  } from "../stores";
  import LinkedBadges from "./LinkedBadges.svelte";
  import FilterPicker from "./FilterPicker.svelte";

  let { onLoadMore }: { onLoadMore: () => void | Promise<void> } = $props();

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

  // Category filters mirror github.com/notifications default filters. Unread
  // is orthogonal (read-state, not a category) and lives in its own toggle.
  let searchQuery = $state("");

  /** Client-side filter over loaded items only — GitHub's Notifications API
   * has no full-text search endpoint, so search never reaches further back
   * than what's already been paged in. */
  function matchesSearch(item: InboxItem, q: string): boolean {
    if (!q) return true;
    const needle = q.toLowerCase();
    return (
      item.issue.title.toLowerCase().includes(needle) ||
      (repoFullName(item.issue) ?? "").toLowerCase().includes(needle) ||
      reasonLabel(item.reason).toLowerCase().includes(needle)
    );
  }

  // Every category, in github.com/notifications order. `other` bundles the
  // remaining reasons (subscribed, CI activity, releases, state changes, …) —
  // on a typical inbox that's the bulk of the list, so it needs to be
  // filterable (both to isolate and to exclude), not just an "All"-only bucket.
  const CATEGORIES: { key: InboxCategory; label: string }[] = [
    { key: "review_requested", label: "Review requested" },
    { key: "mentioned", label: "Mentioned" },
    { key: "participating", label: "Participating" },
    { key: "assigned", label: "Assigned" },
    { key: "other", label: "Subscribed & other" },
  ];

  const counts = $derived(
    Object.fromEntries(
      CATEGORIES.map((c) => [
        c.key,
        $inbox.filter((i) => i.category === c.key).length,
      ]),
    ) as Record<InboxCategory, number>,
  );

  const categoryOptions = $derived(
    CATEGORIES.map((c) => ({
      value: c.key,
      label: c.label,
      count: counts[c.key],
    })),
  );

  // Empty category set = all categories. Unread toggle AND-narrows.
  function inFilter(item: InboxItem): boolean {
    if ($inboxUnreadOnly && !item.unread) return false;
    if ($inboxCategoryFilters.size === 0) return true;
    return $inboxCategoryFilters.has(item.category);
  }

  const filtered = $derived(
    $inbox.filter((i) => inFilter(i) && matchesSearch(i, searchQuery.trim())),
  );

  function relTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const s = Math.max(0, (Date.now() - then) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  // ---- Selection state ----
  // Ids only; the rows themselves are replaced wholesale on every refresh
  // (App.svelte drops scrolled-in pages), so holding item references would
  // pin stale objects.
  let selectedIds = $state(new Set<string>());

  function toggleSelect(nodeId: string) {
    const next = new Set(selectedIds);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    selectedIds = next;
  }

  function clearSelection() {
    selectedIds = new Set();
  }

  /** The selection intersected with what's actually on screen. Every action
   * and every count derives from this, never from `selectedIds` directly:
   * filters narrow `filtered` and the 90s refresh replaces `$inbox` outright,
   * so the raw set can hold ids with no visible row — and marking a thread
   * read is a real PATCH to GitHub, not a local dismissal. Acting on rows the
   * user can't see would mutate their inbox behind their back. */
  const selectedVisible = $derived(
    filtered.filter((i) => selectedIds.has(i.issue.node_id)),
  );
  const anySelected = $derived(selectedVisible.length > 0);

  // ---- Mark-read actions ----
  /** Mark an item read — flips it locally (optimistic, matches the row
   * staying visible like github.com/notifications does for read items) and
   * marks the real GitHub notification thread read. The Inbox is a mirror,
   * so this is never a local-only dismissal — it always reaches GitHub. */
  function markRead(nodeId: string) {
    $inbox = $inbox.map((i) =>
      i.issue.node_id === nodeId ? { ...i, unread: false } : i,
    );
    void api
      .markNotificationRead(nodeId)
      .catch((e) => console.warn("[ghtasks] mark_notification_read failed:", e));
  }

  /** Flip a set of ids read locally, then push the same set to GitHub. On
   * failure the rows revert, so the list stops claiming a state GitHub
   * rejected — the next refresh would undo them anyway, just 90s later. */
  function markManyRead(ids: string[]) {
    if (ids.length === 0) return;
    const target = new Set(ids);
    const wasUnread = new Set(
      $inbox
        .filter((i) => i.unread && target.has(i.issue.node_id))
        .map((i) => i.issue.node_id),
    );
    $inbox = $inbox.map((i) =>
      target.has(i.issue.node_id) ? { ...i, unread: false } : i,
    );
    void api.markNotificationsRead(ids).catch((e) => {
      console.warn("[ghtasks] mark_notifications_read failed:", e);
      $inbox = $inbox.map((i) =>
        wasUnread.has(i.issue.node_id) ? { ...i, unread: true } : i,
      );
    });
  }

  function markSelectedRead() {
    markManyRead(selectedVisible.map((i) => i.issue.node_id));
    clearSelection();
  }

  // ---- "Mark all as read" ----
  // Two different operations wear this label, and conflating them is what
  // makes it a lie: with no filter it means the user's whole GitHub inbox
  // (including threads never paged in), which only `PUT /notifications` can
  // do; under a filter it can only honestly mean the rows on screen.
  const filteringActive = $derived(
    $inboxCategoryFilters.size > 0 ||
      $inboxUnreadOnly ||
      searchQuery.trim() !== "",
  );
  const visibleUnread = $derived(filtered.filter((i) => i.unread));
  const canMarkAll = $derived(
    filteringActive ? visibleUnread.length > 0 : $inbox.some((i) => i.unread),
  );
  const markAllLabel = $derived(
    filteringActive ? `Mark ${visibleUnread.length} read` : "Mark all read",
  );

  /** Armed by the first click; the second confirms. Bulk mark-read can't be
   * undone from this app, and unfiltered it reaches threads that were never
   * on screen, so it doesn't get to fire on a single stray click. */
  let markAllArmed = $state(false);
  let disarmTimer: ReturnType<typeof setTimeout> | undefined;

  function disarmMarkAll() {
    markAllArmed = false;
    clearTimeout(disarmTimer);
  }

  function markAllRead() {
    if (!canMarkAll) return;
    if (!markAllArmed) {
      markAllArmed = true;
      clearTimeout(disarmTimer);
      disarmTimer = setTimeout(() => (markAllArmed = false), 4000);
      return;
    }
    disarmMarkAll();

    if (filteringActive) {
      markManyRead(visibleUnread.map((i) => i.issue.node_id));
    } else {
      const ids = new Set($inbox.filter((i) => i.unread).map((i) => i.issue.node_id));
      $inbox = $inbox.map((i) => (i.unread ? { ...i, unread: false } : i));
      void api.markAllNotificationsRead(new Date().toISOString()).catch((e) => {
        console.warn("[ghtasks] mark_all_notifications_read failed:", e);
        $inbox = $inbox.map((i) =>
          ids.has(i.issue.node_id) ? { ...i, unread: true } : i,
        );
      });
    }
    clearSelection();
  }

  $effect(() => () => clearTimeout(disarmTimer));

  async function open(issue: Issue) {
    markRead(issue.node_id);
    await openUrl(issue.html_url);
  }

  /** The chevron opens the item. Concrete issues/PRs drill into the in-app
   * detail view; non-addressable items (CI runs, releases, …) open on GitHub. */
  async function drillIn(item: InboxItem) {
    markRead(item.issue.node_id);
    const repo = repoFullName(item.issue);
    if (!item.addressable || !repo) {
      await openUrl(item.issue.html_url);
      return;
    }
    $appView = {
      kind: "detail",
      repo,
      number: item.issue.number,
      nodeId: item.issue.node_id,
    };
  }

  // Infinite scroll: observe a sentinel at the bottom of the list and load
  // the next page when it enters the scroll container's viewport. Only wired
  // up while fully unfiltered (no category, no unread-only, no search) —
  // category/unread/search filters operate on already-loaded items, so
  // scrolling under a filter shouldn't silently fetch unrelated pages the
  // user can't see the effect of.
  let sentinel: HTMLElement | null = $state(null);
  const canLoadMore = $derived(
    $inboxCategoryFilters.size === 0 &&
      !$inboxUnreadOnly &&
      searchQuery.trim() === "" &&
      $inboxHasMore,
  );

  $effect(() => {
    if (!sentinel || !canLoadMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void onLoadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });
</script>

<div class="wrap">
  {#if $inbox.length > 0}
    <div class="toolbar">
      <div class="filter">
        <FilterPicker
          label="Category"
          emptyLabel="All"
          options={categoryOptions}
          selected={$inboxCategoryFilters}
          onChange={(next) => ($inboxCategoryFilters = next)}
        />
        <button
          class="unread-toggle"
          class:active={$inboxUnreadOnly}
          onclick={() => ($inboxUnreadOnly = !$inboxUnreadOnly)}
          aria-pressed={$inboxUnreadOnly}
          title="Show only unread notifications"
        >
          <span class="unread-check" aria-hidden="true">
            {#if $inboxUnreadOnly}✓{/if}
          </span>
          Unread only
        </button>
      </div>
      <div class="search">
        <svg
          class="search-icon"
          viewBox="0 0 16 16"
          width="12"
          height="12"
          aria-hidden="true"
        >
          <path
            fill="currentColor"
            d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z"
          />
        </svg>
        <input
          type="text"
          class="search-input"
          placeholder="Search loaded items…"
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button
            class="search-clear"
            aria-label="Clear search"
            onclick={() => (searchQuery = "")}
          >
            ×
          </button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Bulk actions. Lives on its own row rather than in the toolbar: at the
       app's fixed 480px width the toolbar has no room left once a category
       label is showing, and it gives the confirm step somewhere to expand. -->
  {#if anySelected || canMarkAll}
    <div class="bulk-bar">
      {#if anySelected}
        <span class="count">{selectedVisible.length} selected</span>
        <button
          class="mark-btn"
          title="Mark selected notifications as read"
          onclick={markSelectedRead}
        >
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path
              fill="currentColor"
              d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z"
            />
          </svg>
          Mark as read
        </button>
        <button class="clear-btn" onclick={clearSelection}>Clear</button>
      {/if}
      {#if canMarkAll}
        <button
          class="mark-all-btn"
          class:armed={markAllArmed}
          title={filteringActive
            ? "Mark the unread notifications matching this filter as read"
            : "Mark your entire GitHub notification inbox as read"}
          onclick={markAllRead}
          onblur={disarmMarkAll}
        >
          {markAllArmed ? "Click again to confirm" : markAllLabel}
        </button>
      {/if}
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
      <div class="empty-body">
        {searchQuery
          ? "No loaded items match your search."
          : "No items match this filter."}
      </div>
    </div>
  {:else}
    <ul class="issues" data-density={$rowDensity}>
      {#each filtered as item (item.issue.node_id)}
        <li
          class="issue"
          class:read={!item.unread}
          class:selected={selectedIds.has(item.issue.node_id)}
        >
          <button
            class="cb"
            class:checked={selectedIds.has(item.issue.node_id)}
            aria-label="Select {item.issue.title}"
            aria-checked={selectedIds.has(item.issue.node_id)}
            role="checkbox"
            onclick={() => toggleSelect(item.issue.node_id)}
          >
            <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
              <path
                fill="currentColor"
                d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z"
              />
            </svg>
          </button>
          <span class="unread-dot" class:visible={item.unread} aria-hidden="true"
          ></span>
          <div class="body">
            <div class="row1">
              <button class="title" onclick={() => open(item.issue)}>
                {item.issue.title}
              </button>
              <span class="reason">{reasonLabel(item.reason)}</span>
              {#if item.unread}
                <button
                  class="act"
                  title="Mark read"
                  aria-label="Mark read"
                  onclick={() => markRead(item.issue.node_id)}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z"
                    />
                  </svg>
                </button>
              {/if}
              <button
                class="drill"
                title="View on GitHub"
                aria-label="View on GitHub"
                onclick={() => drillIn(item)}
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
                >{repoFullName(item.issue) ?? ""}{#if item.addressable}<span
                    class="num">#{item.issue.number}</span
                  >{/if}</span
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
      {#if canLoadMore}
        <li class="sentinel-row" bind:this={sentinel}>
          {#if $inboxLoadingMore}
            <div class="loader small" aria-hidden="true"></div>
            <span>Loading more…</span>
          {/if}
        </li>
      {/if}
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
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex: 0 0 auto;
  }
  .filter {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /* Read-state toggle — visually a sibling pill to the FilterPicker trigger,
     matching its size/shape so the two read as one filter cluster. */
  .unread-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 11px;
    color: var(--text-dim);
    cursor: pointer;
    white-space: nowrap;
  }
  .unread-toggle:hover {
    color: var(--text);
  }
  .unread-toggle.active {
    color: var(--text);
    border-color: var(--accent);
  }
  .unread-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid var(--border);
    font-size: 9px;
    line-height: 1;
    flex: 0 0 auto;
  }
  .unread-toggle.active .unread-check {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 120px;
  }
  .search-icon {
    position: absolute;
    left: 7px;
    color: var(--text-dim);
    pointer-events: none;
  }
  .wrap .toolbar .search input.search-input {
    width: 100%;
    padding: 4px 22px 4px 24px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    color: var(--text);
    font-size: 11px;
    line-height: 1.4;
  }
  .search-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .search-input::placeholder {
    color: var(--text-dim);
  }
  .search-clear {
    all: unset;
    cursor: pointer;
    position: absolute;
    right: 5px;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1;
  }
  .search-clear:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  /* ---- Bulk-action bar ---- */
  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    background: var(--bg-elev);
    border-bottom: 1px solid var(--border);
    flex: 0 0 auto;
  }
  .bulk-bar .count {
    font-size: 11px;
    color: var(--accent);
    font-weight: 600;
    flex: 0 0 auto;
  }
  .bulk-bar .mark-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    background: color-mix(in srgb, #3fb950 12%, transparent);
    border: 1px solid color-mix(in srgb, #3fb950 30%, transparent);
    border-radius: 6px;
    font-size: 11px;
    color: #3fb950;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }
  .bulk-bar .mark-btn:hover {
    background: color-mix(in srgb, #3fb950 20%, transparent);
  }
  .bulk-bar .clear-btn {
    background: transparent;
    border: none;
    color: var(--text-dim);
    font-size: 11px;
    cursor: pointer;
    padding: 2px 4px;
    flex: 0 0 auto;
  }
  .bulk-bar .clear-btn:hover {
    color: var(--text);
  }
  /* Pushed to the trailing edge so the irreversible action never sits where
     the eye expects "Mark as read" for the current selection. */
  .bulk-bar .mark-all-btn {
    margin-left: auto;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 11px;
    color: var(--text-dim);
    cursor: pointer;
    white-space: nowrap;
    flex: 0 0 auto;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
  }
  .bulk-bar .mark-all-btn:hover {
    color: #3fb950;
    background: color-mix(in srgb, #3fb950 10%, transparent);
  }
  .bulk-bar .mark-all-btn.armed {
    color: #3fb950;
    border-color: color-mix(in srgb, #3fb950 45%, transparent);
    background: color-mix(in srgb, #3fb950 14%, transparent);
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
  /* Unread mirrors github.com/notifications: bold title + a small accent dot
     in the gutter. Read items drop both — normal weight, no dot — rather
     than being dimmed, so a long-scrolled history doesn't read as "greyed
     out and broken." */
  .issue.read .title {
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
  .issue.selected {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .issue.selected:hover {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }

  /* Checkbox — dimmed until the row is hovered, selected, or focused. It's a
     tab stop on every row, so it must never be both focused and invisible;
     `all: unset` drops the UA focus ring and the border-box default, so both
     are restored explicitly. */
  .cb {
    all: unset;
    box-sizing: border-box;
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    border-radius: 4px;
    border: 1.5px solid var(--border);
    background: transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: transparent;
    transition: background 0.1s, border-color 0.1s, opacity 0.1s;
    opacity: 0;
  }
  .issue:hover .cb,
  .issue.selected .cb,
  .cb:focus-visible {
    opacity: 1;
  }
  .cb:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .cb:hover {
    border-color: var(--text-dim);
  }
  .cb.checked {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .unread-dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    margin-top: 6px;
    border-radius: 50%;
    background: transparent;
  }
  .unread-dot.visible {
    background: var(--accent);
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
    font-weight: 600;
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
  .sentinel-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px;
    color: var(--text-dim);
    font-size: 11.5px;
  }
  .loader {
    border-radius: 50%;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    animation: loader-spin 0.8s linear infinite;
  }
  .loader.small {
    width: 14px;
    height: 14px;
    border-width: 2px;
  }
  @keyframes loader-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
