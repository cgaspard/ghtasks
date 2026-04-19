<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./lib/api";
  import {
    auth,
    sources,
    sourceResults,
    loading,
    lastError,
    activeTab,
  } from "./lib/stores";
  import Login from "./lib/components/Login.svelte";
  import IssueList from "./lib/components/IssueList.svelte";
  import SourceEditor from "./lib/components/SourceEditor.svelte";
  import NewIssue from "./lib/components/NewIssue.svelte";
  import Settings from "./lib/components/Settings.svelte";
  import TopBar from "./lib/components/TopBar.svelte";

  let pollHandle: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    if (!$auth.authenticated) return;
    $loading = true;
    $lastError = null;
    try {
      const [srcs, results] = await Promise.all([
        api.listSources(),
        api.fetchAll(),
      ]);
      $sources = srcs;
      $sourceResults = results;
    } catch (e) {
      $lastError = String(e);
    } finally {
      $loading = false;
    }
  }

  async function refreshAuth() {
    try {
      const status = await api.authStatus();
      $auth = status;
      if (status.authenticated) {
        await refresh();
      }
    } catch (e) {
      $lastError = String(e);
    }
  }

  onMount(() => {
    void refreshAuth();
    // Poll every 90s while authenticated.
    pollHandle = setInterval(() => {
      if ($auth.authenticated) refresh();
    }, 90_000);
    return () => {
      if (pollHandle) clearInterval(pollHandle);
    };
  });
</script>

<main class="app">
  {#if !$auth.authenticated}
    <Login onAuthed={refreshAuth} />
  {:else}
    <TopBar onRefresh={refresh} />
    <div class="body">
      {#if $activeTab === "issues"}
        <IssueList />
      {:else if $activeTab === "sources"}
        <SourceEditor onChanged={refresh} />
      {:else if $activeTab === "new"}
        <NewIssue onCreated={refresh} />
      {:else if $activeTab === "settings"}
        <Settings />
      {/if}
    </div>
    {#if $lastError}
      <div class="error" role="alert">{$lastError}</div>
    {/if}
  {/if}
</main>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  .body {
    flex: 1;
    overflow: auto;
    min-height: 0;
  }
  .error {
    background: rgba(229, 72, 77, 0.15);
    color: #ffb4b7;
    padding: 6px 10px;
    font-size: 12px;
    border-top: 1px solid rgba(229, 72, 77, 0.3);
  }
</style>
