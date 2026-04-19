<script lang="ts">
  import { api } from "../api";
  import { activeTab, auth, loading } from "../stores";

  interface Props {
    onRefresh: () => Promise<void> | void;
  }
  let { onRefresh }: Props = $props();

  async function logout() {
    await api.authLogout();
    $auth = { authenticated: false, user: null };
  }
</script>

<header class="bar">
  <nav class="tabs">
    <button
      class:active={$activeTab === "issues"}
      onclick={() => ($activeTab = "issues")}>Issues</button
    >
    <button
      class:active={$activeTab === "sources"}
      onclick={() => ($activeTab = "sources")}>Sources</button
    >
    <button
      class:active={$activeTab === "new"}
      onclick={() => ($activeTab = "new")}>New</button
    >
    <button
      class:active={$activeTab === "settings"}
      onclick={() => ($activeTab = "settings")}>Settings</button
    >
  </nav>
  <div class="right">
    <button class="ghost icon" onclick={() => onRefresh()} disabled={$loading} title="Refresh">
      {#if $loading}…{:else}↻{/if}
    </button>
    {#if $auth.user}
      <img class="avatar" src={$auth.user.avatar_url} alt={$auth.user.login} />
      <button class="ghost small" onclick={logout} title="Log out">×</button>
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
  }
  .icon {
    width: 28px;
    padding: 4px 0;
    text-align: center;
  }
  .small {
    padding: 2px 6px;
    font-size: 14px;
    line-height: 1;
  }
</style>
