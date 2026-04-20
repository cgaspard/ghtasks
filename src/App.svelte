<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./lib/api";
  import {
    auth,
    sources,
    sourceResults,
    projectResults,
    loading,
    lastError,
    activeTab,
    showNewIssue,
    lastSyncAt,
    newSinceLastSync,
  } from "./lib/stores";
  import Login from "./lib/components/Login.svelte";
  import IssueList from "./lib/components/IssueList.svelte";
  import ProjectList from "./lib/components/ProjectList.svelte";
  import NewIssue from "./lib/components/NewIssue.svelte";
  import Settings from "./lib/components/Settings.svelte";
  import TopBar from "./lib/components/TopBar.svelte";

  let pollHandle: ReturnType<typeof setInterval> | null = null;

  /** Collect every issue/project-item node_id currently in the stores. */
  function knownNodeIds(): Set<string> {
    const set = new Set<string>();
    for (const r of $sourceResults) {
      for (const i of r.issues) if (i.node_id) set.add(i.node_id);
    }
    for (const r of $projectResults) {
      for (const it of r.snapshot?.items ?? []) {
        if (it.issue.node_id) set.add(it.issue.node_id);
      }
    }
    return set;
  }

  async function refresh() {
    if (!$auth.authenticated) return;
    $loading = true;
    $lastError = null;
    console.log("[ghtasks] refresh() invoking fetchAll + fetchAllProjects");
    const priorIds = knownNodeIds();
    try {
      const [srcs, results, projects] = await Promise.all([
        api.listSources(),
        api.fetchAll(),
        api.fetchAllProjects(),
      ]);
      $sources = srcs;
      $sourceResults = results;
      $projectResults = projects;

      // Count items in the new payload that weren't in the prior snapshot.
      let fresh = 0;
      for (const r of results) {
        for (const i of r.issues)
          if (i.node_id && !priorIds.has(i.node_id)) fresh++;
      }
      for (const r of projects) {
        for (const it of r.snapshot?.items ?? []) {
          if (it.issue.node_id && !priorIds.has(it.issue.node_id)) fresh++;
        }
      }
      // Don't surface "new" on the very first sync (priorIds is empty).
      $newSinceLastSync = priorIds.size === 0 ? 0 : fresh;
      $lastSyncAt = Date.now();

      const issueTotal = results.reduce((n, r) => n + r.issues.length, 0);
      const projectTotal = projects.reduce(
        (n, r) => n + (r.snapshot?.items.length ?? 0),
        0,
      );
      console.log(
        `[ghtasks] refresh() complete: ${srcs.length} source(s), ${issueTotal} issue(s), ${projectTotal} project item(s), new=${$newSinceLastSync}`,
      );
    } catch (e) {
      console.error("[ghtasks] refresh() failed:", e);
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

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "q") {
      e.preventDefault();
      void api.quit();
    }
  }

  onMount(() => {
    void refreshAuth();
    // Poll every 90s while authenticated.
    pollHandle = setInterval(() => {
      if ($auth.authenticated) refresh();
    }, 90_000);
    window.addEventListener("keydown", onKeydown);
    return () => {
      if (pollHandle) clearInterval(pollHandle);
      window.removeEventListener("keydown", onKeydown);
    };
  });
</script>

<main class="app">
  {#if !$auth.authenticated}
    <Login onAuthed={refreshAuth} />
  {:else}
    <TopBar onRefresh={refresh} />
    <div class="body">
      {#if $activeTab === "projects"}
        <ProjectList />
      {:else if $activeTab === "issues"}
        <IssueList />
      {:else if $activeTab === "settings"}
        <Settings onSourcesChanged={refresh} />
      {/if}
    </div>
    {#if $showNewIssue}
      <NewIssue onCreated={refresh} />
    {/if}
  {/if}
  {#if $lastError}
    <div class="error" role="alert">{$lastError}</div>
  {/if}
</main>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    position: relative;
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
