<script lang="ts">
  import { onMount, tick } from "svelte";
  import { api } from "../api";
  import {
    activeTab,
    auth,
    showNewIssue,
    appVersion,
    appView,
    updateAvailable,
    unreadCount,
    settingsSection,
    lastError,
  } from "../stores";

  async function quit() {
    await api.quit();
  }
  async function logout() {
    menuOpen = false;
    try {
      await api.authLogout();
      $auth = { authenticated: false, user: null };
    } catch (e) {
      lastError.set(String(e));
    }
  }
  function navigate(tab: "projects" | "issues" | "inbox" | "settings") {
    $appView = { kind: "list" };
    $activeTab = tab;
    if (tab === "settings") $settingsSection = "home";
  }
  function openSettings() {
    menuOpen = false;
    navigate("settings");
  }
  async function openDevtools() {
    menuOpen = false;
    await api.openDevtools();
  }
  function openAbout() {
    menuOpen = false;
    $appView = { kind: "about" };
  }

  // Avatar popover open state.
  let menuOpen = $state(false);
  let menuRoot: HTMLDivElement | undefined = $state();
  let avatarButton: HTMLButtonElement | undefined = $state();
  async function toggleMenu() {
    menuOpen = !menuOpen;
    if (menuOpen) {
      await tick();
      menuRoot?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    }
  }

  function onDocClick(e: MouseEvent) {
    if (!menuOpen) return;
    if (menuRoot && !menuRoot.contains(e.target as Node)) menuOpen = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && menuOpen) {
      menuOpen = false;
      avatarButton?.focus();
      return;
    }
    if (menuOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const items = [...(menuRoot?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      return;
    }
    // ⌘, / Ctrl+, → Settings
    if ((e.metaKey || e.ctrlKey) && e.key === "," && !$showNewIssue) {
      e.preventDefault();
      openSettings();
    }
  }

  onMount(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  });

</script>

<header class="bar" data-tauri-drag-region>
  <nav class="tabs" aria-label="Main navigation">
    <button
      class:active={$activeTab === "projects" && $appView.kind === "list"}
      aria-pressed={$activeTab === "projects" && $appView.kind === "list"}
      onclick={() => navigate("projects")}>Projects</button
    >
    <button
      class:active={$activeTab === "issues" && $appView.kind === "list"}
      aria-pressed={$activeTab === "issues" && $appView.kind === "list"}
      onclick={() => navigate("issues")}>Todos</button
    >
    <button
      class="await-tab"
      class:active={$activeTab === "inbox" && $appView.kind === "list"}
      aria-pressed={$activeTab === "inbox" && $appView.kind === "list"}
      onclick={() => navigate("inbox")}
    >
      Inbox
      {#if $unreadCount > 0}
        <span class="await-count">{$unreadCount}</span>
      {/if}
    </button>
  </nav>
  <div class="right">
    <button class="ghost icon settings-button" class:active={$activeTab === "settings" && $appView.kind === "list"} onclick={openSettings} title="Settings" aria-label="Settings" aria-pressed={$activeTab === "settings" && $appView.kind === "list"}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 3-1 3-3 1v4l2 2-1 3 3 2 3-1 3 1 3-2-1-3 2-2V7l-3-1-1-3Z"/><circle cx="12" cy="10.5" r="3"/></svg>
    </button>
    {#if $auth.user}
      <div class="menu-anchor" bind:this={menuRoot}>
        <button
          class="avatar-btn"
          class:active={menuOpen}
          onclick={toggleMenu}
          bind:this={avatarButton}
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
              <span>Quit GitHub Tasks</span>
              <span class="menu-kbd">⌘Q</span>
            </button>
            <div class="menu-sep"></div>
            <button
              class="menu-version"
              onclick={openAbout}
              role="menuitem"
              title="About GitHub Tasks"
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
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 12px;
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
    padding: 6px 9px;
    font-weight: 500;
    border-radius: 6px;
  }
  .tabs button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .tabs button.active, .settings-button.active {
    color: var(--text);
    background: var(--bg-hover);
  }
  .await-tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .await-count {
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: #e3a008;
    color: #1a1205;
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
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
    height: 28px;
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
  @media (max-width: 380px) {
    .bar { padding-inline: 10px; gap: 4px; }
    .tabs button { padding-inline: 8px; font-size: 12px; }
  }
</style>
