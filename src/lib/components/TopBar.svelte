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
    appVersion,
    appView,
    updateAvailable,
  } from "../stores";

  interface Props {
    onRefresh: () => Promise<void> | void;
  }
  let { onRefresh }: Props = $props();

  async function quit() {
    await api.quit();
  }
  async function logout() {
    menuOpen = false;
    await api.authLogout();
    $auth = { authenticated: false, user: null };
  }
  function openSettings() {
    menuOpen = false;
    $activeTab = "settings";
  }
  async function openDevtools() {
    menuOpen = false;
    await api.openDevtools();
  }
  function openAbout() {
    menuOpen = false;
    $appView = { kind: "about" };
  }

  // Tick the "synced Xm ago" label every 20s so it stays fresh without
  // reading Date.now() in the template.
  let now = $state(Date.now());
  let tickHandle: ReturnType<typeof setInterval> | null = null;

  // Avatar popover open state.
  let menuOpen = $state(false);
  let menuRoot: HTMLDivElement | undefined = $state();

  function onDocClick(e: MouseEvent) {
    if (!menuOpen) return;
    if (menuRoot && !menuRoot.contains(e.target as Node)) menuOpen = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && menuOpen) {
      menuOpen = false;
      return;
    }
    // ⌘, / Ctrl+, → Settings
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      $activeTab = "settings";
    }
  }

  onMount(() => {
    tickHandle = setInterval(() => (now = Date.now()), 20_000);
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      if (tickHandle) clearInterval(tickHandle);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
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
  </nav>
  <div class="right">
    {#if agoLabel}
      <span class="sync-label" title={agoLabel}>{agoLabel}</span>
    {/if}
    <button
      class="ghost icon"
      onclick={() => ($showNewIssue = true)}
      title="New issue"
      aria-label="New issue">+</button
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
      aria-label="Refresh"
    >
      <span class="spin-wrap" aria-hidden="true">↻</span>
      {#if $newSinceLastSync > 0 && !$loading}
        <span class="new-badge" aria-label="New items">{$newSinceLastSync}</span>
      {/if}
    </button>

    {#if $auth.user}
      <div class="menu-anchor" bind:this={menuRoot}>
        <button
          class="avatar-btn"
          class:active={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
          title={$auth.user.login}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <img
            class="avatar"
            src={$auth.user.avatar_url}
            alt={$auth.user.login}
          />
          {#if $updateAvailable}
            <span class="update-badge" aria-label="Update available" title="Update available"></span>
          {/if}
        </button>

        {#if menuOpen}
          <div class="menu" role="menu">
            <div class="menu-user">
              <img
                class="avatar lg"
                src={$auth.user.avatar_url}
                alt={$auth.user.login}
              />
              <div class="menu-user-text">
                <div class="menu-user-name">{$auth.user.name ?? $auth.user.login}</div>
                <div class="menu-user-login muted">@{$auth.user.login}</div>
              </div>
            </div>
            <div class="menu-sep"></div>
            {#if $updateAvailable}
              <button
                class="menu-item update-row"
                onclick={openAbout}
                role="menuitem"
                title="A new version is available"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm6.5-3a.75.75 0 0 1 .75.75V8h2.25a.75.75 0 0 1 .53 1.28l-3 3a.75.75 0 0 1-1.06 0l-3-3A.75.75 0 0 1 4.5 8H6.75V5.75A.75.75 0 0 1 7.5 5h.5Z"
                  />
                </svg>
                <span>Update to v{$updateAvailable.version}</span>
              </button>
              <div class="menu-sep"></div>
            {/if}
            <button class="menu-item" onclick={openAbout} role="menuitem">
              <!-- info -->
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm6.5-.25A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
                />
              </svg>
              <span>About</span>
            </button>
            <button class="menu-item" onclick={openSettings} role="menuitem">
              <!-- gear -->
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.18.695.759 1.21 1.473 1.388l1.117.277c.658.164 1.201.71 1.263 1.452.03.344.04.69.023 1.038a5.91 5.91 0 0 1-.215 1.17c-.145.597-.518 1.14-1.083 1.361l-1.064.417c-.68.266-1.153.926-1.153 1.66 0 .735.473 1.395 1.153 1.661l1.064.417c.565.22.938.765 1.083 1.361.117.49.186.988.215 1.488.017.347.007.693-.023 1.038-.062.741-.605 1.288-1.263 1.452l-1.117.277c-.714.178-1.294.693-1.473 1.388l-.288 1.107c-.17.645-.716 1.195-1.459 1.259a8.2 8.2 0 0 1-1.402 0c-.743-.064-1.29-.614-1.46-1.259l-.287-1.107c-.18-.695-.76-1.21-1.473-1.388l-1.117-.277C1.658 13.705 1.116 13.16 1.054 12.419a8.27 8.27 0 0 1-.023-1.038c.029-.5.098-.998.215-1.488.145-.596.518-1.14 1.083-1.36l1.064-.418c.68-.266 1.153-.926 1.153-1.66 0-.734-.473-1.394-1.153-1.66l-1.064-.417c-.565-.221-.938-.765-1.083-1.361A8.198 8.198 0 0 1 1.031 5.55a5.91 5.91 0 0 1 .023-1.037c.062-.742.604-1.289 1.263-1.453l1.117-.277c.714-.178 1.293-.693 1.473-1.388L5.194 1.29c.17-.645.716-1.195 1.46-1.259A8.2 8.2 0 0 1 8 0Zm0 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
                />
              </svg>
              <span>Settings</span>
              <span class="menu-kbd">⌘,</span>
            </button>
            <button class="menu-item" onclick={openDevtools} role="menuitem">
              <!-- terminal / devtools -->
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.75.75 0 0 1-.22.53l-2.25 2.25a.75.75 0 1 1-1.06-1.06L5.44 8 3.72 6.28a.75.75 0 1 1 1.06-1.06l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z"
                />
              </svg>
              <span>Developer Tools</span>
            </button>
            <button class="menu-item" onclick={logout} role="menuitem">
              <!-- sign out -->
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M6.25 2.75A1.75 1.75 0 0 1 8 1h3.5A2.75 2.75 0 0 1 14.25 3.75v8.5A2.75 2.75 0 0 1 11.5 15H8a1.75 1.75 0 0 1-1.75-1.75V12h1.5v1.25c0 .138.112.25.25.25h3.5a1.25 1.25 0 0 0 1.25-1.25v-8.5A1.25 1.25 0 0 0 11.5 2.5H8a.25.25 0 0 0-.25.25V4h-1.5V2.75ZM9.78 7.47 7.53 5.22l-1.06 1.06.97.97H2v1.5h5.44l-.97.97 1.06 1.06L9.78 8.53a.75.75 0 0 0 0-1.06Z"
                />
              </svg>
              <span>Sign out</span>
            </button>
            <div class="menu-sep"></div>
            <button class="menu-item danger" onclick={quit} role="menuitem">
              <!-- power -->
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 0a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0Zm-4.41 3.24a.75.75 0 1 1 .944 1.166 5.5 5.5 0 1 0 6.932 0 .75.75 0 0 1 .944-1.166 7 7 0 1 1-8.82 0Z"
                />
              </svg>
              <span>Quit GH Tasks</span>
              <span class="menu-kbd">⌘Q</span>
            </button>
            <div class="menu-sep"></div>
            <button
              class="menu-version"
              onclick={openAbout}
              role="menuitem"
              title="About GH Tasks"
            >
              v{$appVersion ?? "…"}
            </button>
          </div>
        {/if}
      </div>
    {/if}
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
    display: block;
  }
  .avatar.lg {
    width: 28px;
    height: 28px;
  }
  .menu-anchor {
    position: relative;
  }
  .avatar-btn {
    all: unset;
    cursor: pointer;
    border-radius: 50%;
    padding: 0;
    line-height: 0;
    position: relative;
    transition: box-shadow 0.12s;
  }
  .avatar-btn:hover {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .avatar-btn.active {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .update-badge {
    position: absolute;
    top: -3px;
    right: -3px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #f0b429;
    border: 2px solid var(--bg-elev);
    pointer-events: none;
    box-shadow: 0 0 0 0 color-mix(in srgb, #f0b429 60%, transparent);
    animation: badge-pulse 2s ease-in-out infinite;
  }
  @keyframes badge-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 color-mix(in srgb, #f0b429 60%, transparent);
    }
    50% {
      box-shadow: 0 0 0 4px color-mix(in srgb, #f0b429 0%, transparent);
    }
  }
  .update-row {
    color: #f0b429;
  }
  .update-row:hover {
    background: color-mix(in srgb, #f0b429 18%, transparent);
  }
  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 220px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
    z-index: 60;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .menu-user {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
  }
  .menu-user-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .menu-user-name {
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu-user-login {
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu-sep {
    height: 1px;
    background: var(--border);
    margin: 2px 0;
  }
  .menu-item {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--text);
  }
  .menu-item:hover {
    background: var(--bg-hover);
  }
  .menu-item.danger:hover {
    background: color-mix(in srgb, var(--danger) 22%, transparent);
    color: var(--text);
  }
  .menu-item > span:nth-of-type(1) {
    flex: 1;
  }
  .menu-kbd {
    font-size: 10px;
    color: var(--text-dim);
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .menu-version {
    all: unset;
    cursor: pointer;
    display: block;
    padding: 4px 8px;
    font-size: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--text-dim);
    text-align: center;
    border-radius: 6px;
    letter-spacing: 0.3px;
  }
  .menu-version:hover {
    background: var(--bg-hover);
    color: var(--text);
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
