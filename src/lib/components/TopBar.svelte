<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../api";
  import {
    activeTab,
    auth,
    loading,
    showNewIssue,
    lastSyncAt,
    newSinceLastSync,
  } from "../stores";

  async function quit() {
    await api.quit();
  }

  interface Props {
    onRefresh: () => Promise<void> | void;
  }
  let { onRefresh }: Props = $props();

  // Tick the "synced Xm ago" label every 20s so it stays fresh without
  // reading Date.now() in the template.
  let now = $state(Date.now());
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    tickHandle = setInterval(() => (now = Date.now()), 20_000);
    return () => {
      if (tickHandle) clearInterval(tickHandle);
    };
  });

  const agoLabel = $derived.by(() => {
    if (!$lastSyncAt) return "";
    const diff = Math.max(0, now - $lastSyncAt);
    const s = Math.round(diff / 1000);
    if (s < 10) return "synced just now";
    if (s < 60) return `synced ${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `synced ${m}m ago`;
    const h = Math.round(m / 60);
    return `synced ${h}h ago`;
  });

  async function handleRefresh() {
    $newSinceLastSync = 0;
    await onRefresh();
  }

  async function logout() {
    await api.authLogout();
    $auth = { authenticated: false, user: null };
  }
</script>

<header class="bar" data-tauri-drag-region>
  <nav class="tabs">
    <button
      class:active={$activeTab === "projects"}
      onclick={() => ($activeTab = "projects")}>Projects</button
    >
    <button
      class:active={$activeTab === "issues"}
      onclick={() => ($activeTab = "issues")}>Issues</button
    >
    <button
      class:active={$activeTab === "settings"}
      onclick={() => ($activeTab = "settings")}>Settings</button
    >
  </nav>
  <div class="right">
    {#if agoLabel}
      <span class="sync-label" title={agoLabel}>{agoLabel}</span>
    {/if}
    <button
      class="ghost icon"
      onclick={() => ($showNewIssue = true)}
      title="New issue">+</button
    >
    <button
      class="ghost icon refresh"
      class:spinning={$loading}
      onclick={handleRefresh}
      disabled={$loading}
      title={$loading
        ? "Refreshing…"
        : $newSinceLastSync > 0
          ? `${$newSinceLastSync} new since last view — click to refresh`
          : "Refresh"}
    >
      <span class="spin-wrap" aria-hidden="true">↻</span>
      {#if $newSinceLastSync > 0 && !$loading}
        <span class="new-badge" aria-label="New items">{$newSinceLastSync}</span>
      {/if}
    </button>
    {#if $auth.user}
      <img class="avatar" src={$auth.user.avatar_url} alt={$auth.user.login} />
      <button
        class="ghost icon"
        onclick={logout}
        title="Sign out — {$auth.user.login}"
        aria-label="Sign out"
      >
        <!-- door-arrow (logout) -->
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M6.25 2.75A1.75 1.75 0 0 1 8 1h3.5A2.75 2.75 0 0 1 14.25 3.75v8.5A2.75 2.75 0 0 1 11.5 15H8a1.75 1.75 0 0 1-1.75-1.75V12h1.5v1.25c0 .138.112.25.25.25h3.5a1.25 1.25 0 0 0 1.25-1.25v-8.5A1.25 1.25 0 0 0 11.5 2.5H8a.25.25 0 0 0-.25.25V4h-1.5V2.75ZM9.78 7.47 7.53 5.22l-1.06 1.06.97.97H2v1.5h5.44l-.97.97 1.06 1.06L9.78 8.53a.75.75 0 0 0 0-1.06Z"
          />
        </svg>
      </button>
    {/if}
    <button
      class="ghost icon"
      onclick={quit}
      title="Quit GH Tasks (⌘Q)"
      aria-label="Quit"
    >
      <!-- power (quit) -->
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 0a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0Zm-4.41 3.24a.75.75 0 1 1 .944 1.166 5.5 5.5 0 1 0 6.932 0 .75.75 0 0 1 .944-1.166 7 7 0 1 1-8.82 0Z"
        />
      </svg>
    </button>
  </div>
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
  }
  .tabs {
    display: flex;
    gap: 4px;
  }
  .tabs button {
    background: transparent;
    border: none;
    color: var(--text-dim);
    padding: 4px 8px;
    font-weight: 500;
    border-radius: 6px;
  }
  .tabs button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .tabs button.active {
    color: var(--text);
    background: var(--bg-hover);
  }
  .right {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid var(--border);
  }
  .icon {
    width: 28px;
    height: 24px;
    padding: 0;
    text-align: center;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
  }
  .icon:hover {
    color: var(--text);
  }
  .sync-label {
    font-size: 10px;
    color: var(--text-dim);
    padding-right: 2px;
    white-space: nowrap;
  }
  .new-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--accent);
    color: white;
    font-size: 9px;
    font-weight: 600;
    line-height: 14px;
    text-align: center;
    box-shadow: 0 0 0 2px var(--bg-elev);
  }
  .refresh:disabled {
    opacity: 1;
    cursor: default;
  }
  .spin-wrap {
    display: inline-block;
    line-height: 1;
  }
  .spinning .spin-wrap {
    animation: spin 0.9s linear infinite;
    color: var(--accent);
  }
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
