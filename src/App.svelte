<script lang="ts">
  import { onMount } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getVersion } from "@tauri-apps/api/app";
  import { api, type ProjectPageEvent } from "./lib/api";
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
    lastCacheWriteAt,
    newSinceLastSync,
    recentlyCreated,
    pruneRecentlyCreated,
    appVersion,
    appView,
  } from "./lib/stores";
  import { get } from "svelte/store";
  import Login from "./lib/components/Login.svelte";
  import IssueList from "./lib/components/IssueList.svelte";
  import ProjectList from "./lib/components/ProjectList.svelte";
  import NewIssue from "./lib/components/NewIssue.svelte";
  import Settings from "./lib/components/Settings.svelte";
  import TopBar from "./lib/components/TopBar.svelte";
  import IssueDetail from "./lib/components/IssueDetail.svelte";

  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let unlistenProjectPage: UnlistenFn | null = null;
  /** Bumped on each refresh. Pages arriving for an older generation are
   * ignored so late stragglers don't leak into the next refresh. */
  let refreshGeneration = 0;
  /** Accumulated node_ids before the current refresh started, for new-count. */
  let priorIdsSnapshot: Set<string> = new Set();
  /** Per-source: which item_ids have we seen in the current generation?
   * Used so the final page can evict items no longer on the board. */
  const seenItemsByGen = new Map<string, { gen: number; ids: Set<string> }>();

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

  function handleProjectPage(gen: number, evt: ProjectPageEvent) {
    if (gen !== refreshGeneration) return; // stale
    $projectResults = reconcileProjectPage($projectResults, gen, evt);
  }

  /** Merge an incoming page into the existing snapshot **without clearing**
   * what's already on screen. Items are upserted by item_id; on the final
   * page, items whose id was not seen during this generation are dropped
   * (they were archived / removed on the server). */
  function reconcileProjectPage(
    current: typeof $projectResults,
    gen: number,
    evt: ProjectPageEvent,
  ): typeof $projectResults {
    const existing = current.find((r) => r.source_id === evt.source_id);

    if (evt.error) {
      const errored = {
        source_id: evt.source_id,
        snapshot: existing?.snapshot ?? null,
        error: evt.error,
      };
      return existing
        ? current.map((r) => (r.source_id === evt.source_id ? errored : r))
        : [...current, errored];
    }

    // Reset seen-tracker when a new generation's first page arrives.
    let tracker = seenItemsByGen.get(evt.source_id);
    if (!tracker || tracker.gen !== gen) {
      tracker = { gen, ids: new Set() };
      seenItemsByGen.set(evt.source_id, tracker);
    }
    for (const it of evt.items) tracker.ids.add(it.item_id);

    // If nothing prior, just seed with what we have so far.
    if (!existing?.snapshot) {
      const fresh = {
        source_id: evt.source_id,
        snapshot: {
          project: evt.project,
          fields: evt.fields,
          items: [...evt.items],
        },
        error: null,
      };
      return existing
        ? current.map((r) => (r.source_id === evt.source_id ? fresh : r))
        : [...current, fresh];
    }

    // Upsert this page's items by item_id — no clearing.
    const byId = new Map(existing.snapshot.items.map((i) => [i.item_id, i]));
    for (const incoming of evt.items) byId.set(incoming.item_id, incoming);
    let mergedItems = Array.from(byId.values());

    // On the final page of a generation, drop items that were NOT seen in
    // this generation (archived / removed upstream) — but keep any items
    // that we know we just created (the server may not have indexed them
    // into the project's items() list yet).
    if (evt.is_final) {
      pruneRecentlyCreated();
      const recents = get(recentlyCreated);
      mergedItems = mergedItems.filter(
        (i) =>
          tracker!.ids.has(i.item_id) || recents.has(i.issue.node_id),
      );
    }

    // Update fields only when the incoming event carries them (first page).
    const fields = evt.fields.length > 0 ? evt.fields : existing.snapshot.fields;
    // Project metadata refreshes on every page (cheap).
    const project = evt.project.id ? evt.project : existing.snapshot.project;

    const next = {
      ...existing,
      snapshot: {
        project,
        fields,
        items: mergedItems,
      },
      error: null,
    };
    return current.map((r) =>
      r.source_id === evt.source_id ? next : r,
    );
  }

  /** Merge freshly-created issues (from the recentlyCreated buffer) back
   * into the SourceResult list whenever the GitHub Search API hasn't
   * indexed them yet. */
  function reinjectRecentIntoSourceResults(
    serverResults: typeof $sourceResults,
    currentSources: typeof $sources,
  ): typeof $sourceResults {
    pruneRecentlyCreated();
    const recents = [...get(recentlyCreated).values()];
    if (recents.length === 0) return serverResults;
    let out = serverResults.map((r) => ({ ...r, issues: [...r.issues] }));
    for (const entry of recents) {
      const targetSourceId = currentSources.find(
        (s) => s.kind === "repo" && s.repo === entry.repo && s.enabled,
      )?.id;
      if (!targetSourceId) continue;
      const srIndex = out.findIndex((r) => r.source_id === targetSourceId);
      if (srIndex < 0) continue;
      const already = out[srIndex].issues.some(
        (i) => i.node_id === entry.issue.node_id,
      );
      if (already) continue;
      out[srIndex].issues = [entry.issue, ...out[srIndex].issues];
    }
    return out;
  }

  async function refresh() {
    if (!$auth.authenticated) return;
    $loading = true;
    $lastError = null;
    refreshGeneration++;
    const gen = refreshGeneration;
    priorIdsSnapshot = knownNodeIds();
    pruneRecentlyCreated();
    console.log(
      `[ghtasks] refresh() gen=${gen} streaming projects + fetching repos`,
    );
    try {
      // Kick off both in parallel. Repo fetch is small (search API);
      // project stream fires events that we already listen for.
      const [srcs, results] = await Promise.all([
        api.listSources(),
        api.fetchAll(),
        api.fetchAllProjectsStreaming(),
      ]);
      if (gen !== refreshGeneration) return; // superseded
      $sources = srcs;
      // Before replacing repo source results, keep items that are in our
      // recently-created buffer (Search API needs ~60s to index).
      $sourceResults = reinjectRecentIntoSourceResults(results, srcs);

      // Count new items — streamed projectResults already reflect pages.
      const allIds = knownNodeIds();
      let fresh = 0;
      for (const id of allIds) if (!priorIdsSnapshot.has(id)) fresh++;
      $newSinceLastSync = priorIdsSnapshot.size === 0 ? 0 : fresh;
      $lastSyncAt = Date.now();
      // Persist the "cache written at" timestamp so future cold launches
      // can show "synced Xm ago" against the cached data before the first
      // fresh sync lands.
      $lastCacheWriteAt = $lastSyncAt;

      const issueTotal = results.reduce((n, r) => n + r.issues.length, 0);
      const projectTotal = $projectResults.reduce(
        (n, r) => n + (r.snapshot?.items.length ?? 0),
        0,
      );
      console.log(
        `[ghtasks] refresh() gen=${gen} complete: ${srcs.length} source(s), ${issueTotal} issue(s), ${projectTotal} project item(s), new=${$newSinceLastSync}`,
      );
    } catch (e) {
      console.error("[ghtasks] refresh() failed:", e);
      $lastError = String(e);
    } finally {
      if (gen === refreshGeneration) $loading = false;
    }
  }

  async function refreshAuth() {
    try {
      const status = await api.authStatus();
      $auth = status;
      if (status.authenticated) {
        // Hydrate: if the persistent store already has results, let the UI
        // render them instantly by seeding lastSyncAt from the cache
        // timestamp. The refresh() that follows will stream fresh pages
        // and reconcile on top of the hydrated state.
        if (
          $lastCacheWriteAt !== null &&
          ($sourceResults.length > 0 || $projectResults.length > 0)
        ) {
          $lastSyncAt = $lastCacheWriteAt;
          const sCount = $sourceResults.reduce(
            (n, r) => n + r.issues.length,
            0,
          );
          const pCount = $projectResults.reduce(
            (n, r) => n + (r.snapshot?.items.length ?? 0),
            0,
          );
          console.log(
            `[ghtasks] hydrated ${sCount} issue(s) + ${pCount} project item(s) from cache`,
          );
        }
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
    // Subscribe to streamed project pages once. Each event gets merged
    // into $projectResults, gated by generation so stale pages are dropped.
    void listen<ProjectPageEvent>("project-page", (e) => {
      handleProjectPage(refreshGeneration, e.payload);
    }).then((fn) => {
      unlistenProjectPage = fn;
    });

    void getVersion().then((v) => ($appVersion = v));

    void refreshAuth();
    // Poll every 90s while authenticated.
    pollHandle = setInterval(() => {
      if ($auth.authenticated) refresh();
    }, 90_000);
    window.addEventListener("keydown", onKeydown);
    return () => {
      if (pollHandle) clearInterval(pollHandle);
      if (unlistenProjectPage) unlistenProjectPage();
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
      <div class="slider" class:to-detail={$appView.kind === "detail"}>
        <div
          class="pane list"
          inert={$appView.kind === "detail" ? true : null}
        >
          {#if $activeTab === "projects"}
            <ProjectList />
          {:else if $activeTab === "issues"}
            <IssueList />
          {:else if $activeTab === "settings"}
            <Settings onSourcesChanged={refresh} />
          {/if}
        </div>
        <div
          class="pane detail"
          inert={$appView.kind !== "detail" ? true : null}
        >
          {#if $appView.kind === "detail"}
            <IssueDetail
              repo={$appView.repo}
              number={$appView.number}
              onBack={() => ($appView = { kind: "list" })}
            />
          {/if}
        </div>
      </div>
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
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
  .slider {
    position: absolute;
    top: 0;
    left: 0;
    width: 200%;
    height: 100%;
    display: grid;
    grid-template-columns: 50% 50%;
    grid-template-rows: 100%;
    will-change: transform;
    transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .slider.to-detail {
    transform: translateX(-50%);
  }
  .pane {
    min-width: 0;
    min-height: 0;
    /* Explicit height so child `.wrap` elements (which use
     * `height: 100%`) have a definite value to resolve against. Grid
     * row sizing alone isn't enough — `height: 100%` in a child
     * requires the parent to have a computed height, not just
     * stretch-to-fill behavior. */
    height: 100%;
    overflow: hidden;
  }
  .error {
    background: rgba(229, 72, 77, 0.15);
    color: #ffb4b7;
    padding: 6px 10px;
    font-size: 12px;
    border-top: 1px solid rgba(229, 72, 77, 0.3);
  }
</style>
