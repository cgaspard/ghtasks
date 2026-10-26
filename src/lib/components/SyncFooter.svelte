<script lang="ts">
  import { onMount } from "svelte";
  import {
    activeTab,
    inboxError,
    inboxLastSyncAt,
    inboxLoading,
    lastError,
    lastSyncAt,
    loading,
    newSinceLastSync,
    projectResults,
    sourceResults,
  } from "../stores";

  let { onRefresh }: { onRefresh: () => Promise<void> | void } = $props();
  let now = $state(Date.now());
  const busy = $derived($loading || $inboxLoading);
  const isInbox = $derived($activeTab === "inbox");
  const syncedAt = $derived(isInbox ? $inboxLastSyncAt : $lastSyncAt);
  const needsAttention = $derived(isInbox ? !!$inboxError : !!$lastError || (
    $activeTab === "projects" ? $projectResults.some((result) => result.error) : $sourceResults.some((result) => result.error)
  ));
  const newCount = $derived(isInbox ? 0 : $newSinceLastSync);
  const syncAge = $derived.by(() => {
    if (syncedAt === null) return "";
    const seconds = Math.max(0, Math.round((now - syncedAt) / 1000));
    if (seconds < 10) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  });
  const status = $derived(busy ? "Refreshing…" : needsAttention
    ? `Sync needs attention${syncAge ? ` · Last synced ${syncAge}` : ""}`
    : syncAge ? `Synced ${syncAge}` : "Waiting for first sync");

  onMount(() => {
    const timer = setInterval(() => now = Date.now(), 20_000);
    return () => clearInterval(timer);
  });

  async function refresh() {
    if (busy) return;
    $newSinceLastSync = 0;
    await onRefresh();
  }
</script>

<footer class="sync-footer" aria-label="Sync controls">
  <span class="sync-status" class:attention={needsAttention && !busy} role="status" title={status}>{status}</span>
  <button
    class="ghost refresh"
    onclick={refresh}
    disabled={busy}
    aria-label="Refresh"
    title={busy ? "Refreshing…" : newCount > 0 ? `${newCount} new since last view — refresh tasks` : "Refresh tasks and notifications"}
  >
    <svg class:spinning={busy} viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6.1A8.3 8.3 0 0 1 20 12M4 12a8.3 8.3 0 0 0 13.9 5.9"/></svg>
    {busy ? "Refreshing…" : "Refresh"}
    {#if newCount > 0 && !busy}<span class="new-badge" aria-label="New items">{newCount}</span>{/if}
  </button>
</footer>

<style>
  .sync-footer { display: flex; flex-shrink: 0; align-items: center; gap: 12px; min-height: 47px; padding: 8px 20px; border-top: 1px solid var(--border); color: var(--text-dim); background: var(--bg); }
  .sync-status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .attention { color: #f6c445; }
  .refresh { display: inline-flex; flex-shrink: 0; align-items: center; gap: 6px; padding: 5px 7px; border-color: transparent; font-size: 12px; color: var(--text-dim); }
  .refresh:hover { color: var(--text); }
  .refresh:disabled { opacity: 1; cursor: default; }
  .spinning { animation: spin .9s linear infinite; color: var(--accent); }
  .new-badge { min-width: 16px; padding: 1px 4px; border-radius: 5px; color: var(--text); background: var(--accent-dim); font-size: 10px; text-align: center; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 380px) { .sync-footer { padding-inline: 14px; } }
  @media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
