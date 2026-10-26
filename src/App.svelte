<script lang="ts">
  import { onMount } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getVersion } from "@tauri-apps/api/app";
  import { api, resolveRowDensity, type ProjectPageEvent } from "./lib/api";
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
    recentlyClosed,
    pruneRecentlyCreated,
    appVersion,
    appView,
    updateAvailable,
    rowDensity,
    inbox,
    inboxHasMore,
    inboxLoadingMore,
    inboxPage,
    inboxLoading,
    inboxError,
    inboxLastSyncAt,
    pollIntervalSecs,
    createdIssueNotice,
    seenInboxCues,
  } from "./lib/stores";
  import { get } from "svelte/store";
  import Login from "./lib/components/Login.svelte";
  import IssueList from "./lib/components/IssueList.svelte";
  import ProjectList from "./lib/components/ProjectList.svelte";
  import InboxList from "./lib/components/InboxList.svelte";
  import NewIssue from "./lib/components/NewIssue.svelte";
  import Settings from "./lib/components/Settings.svelte";
  import TopBar from "./lib/components/TopBar.svelte";
  import SyncFooter from "./lib/components/SyncFooter.svelte";
  import IssueDetail from "./lib/components/IssueDetail.svelte";
  import About from "./lib/components/About.svelte";
  import UpdateBanner from "./lib/components/UpdateBanner.svelte";
  import { clearNewIssueDraft } from "./lib/newIssueDraft";

  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let updateCheckHandle: ReturnType<typeof setInterval> | null = null;
  let unlistenProjectPage: UnlistenFn | null = null;
  /** Bumped on each refresh. Pages arriving for an older generation are
   * ignored so late stragglers don't leak into the next refresh. */
  let refreshGeneration = 0;
  let inboxGeneration = 0;
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
    if (gen !== refreshGeneration || !$auth.authenticated) return;
    const closed = get(recentlyClosed);
    const page = closed.size ? { ...evt, items: evt.items.map((item) => closed.has(item.issue.node_id) ? { ...item, issue: { ...item.issue, state: "closed" } } : item) } : evt;
    $projectResults = reconcileProjectPage($projectResults, gen, page);
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

    // Seed a fresh seen-tracker on the first page of this generation's
    // stream (or if the stored tracker belongs to a different generation).
    // Keying the reset to is_first as well as the generation avoids a
    // mid-stream tracker reset contaminating the final-page prune.
    let tracker = seenItemsByGen.get(evt.source_id);
    if (!tracker || tracker.gen !== gen || evt.is_first) {
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
    if (evt.is_final && tracker.gen === gen) {
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
    const closed = get(recentlyClosed);
    let out = serverResults.map((r) => ({ ...r, issues: r.issues.filter((issue) => !closed.has(issue.node_id)) }));
    if (recents.length === 0) return out;
    for (const entry of recents) {
      if (entry.issue.state === "closed" || closed.has(entry.issue.node_id)) continue;
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
    void refreshInbox();
    console.log(
      `[ghtasks] refresh() gen=${gen} streaming projects + fetching repos`,
    );
    try {
      // Kick off both in parallel. Repo fetch is small (search API);
      // project stream fires events that we already listen for.
      const [srcs, results] = await Promise.all([
        api.listSources(),
        api.fetchAll(),
        api.fetchAllProjectsStreaming(gen),
      ]);
      if (gen !== refreshGeneration || !$auth.authenticated) return;
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

  async function refreshInbox() {
    if (!$auth.authenticated) return;
    const gen = ++inboxGeneration;
    $inboxLoading = true;
    $inboxLoadingMore = false;
    $inboxError = null;
    try {
      const page = await api.fetchInbox(1);
      if (gen !== inboxGeneration || !$auth.authenticated) return;
      $inbox = page.items;
      $inboxHasMore = page.has_more;
      $inboxPage = 1;
      $inboxLastSyncAt = Date.now();
    } catch (e) {
      if (gen === inboxGeneration) $inboxError = String(e);
    } finally {
      if (gen === inboxGeneration) $inboxLoading = false;
    }
  }

  /** Append the next page of older inbox items (infinite scroll). Never
   * touches notify bookkeeping or replaces page 1 — it's pure history
   * browsing, so a scroll can't trigger a desktop notification. */
  async function loadMoreInbox() {
    if (get(inboxLoadingMore) || get(inboxLoading) || !get(inboxHasMore)) return;
    const gen = inboxGeneration;
    const nextPage = get(inboxPage) + 1;
    $inboxLoadingMore = true;
    $inboxError = null;
    try {
      const page = await api.fetchInbox(nextPage);
      if (gen !== inboxGeneration || !$auth.authenticated) return;
      const existingIds = new Set($inbox.map((i) => i.issue.node_id));
      const fresh = page.items.filter((i) => !existingIds.has(i.issue.node_id));
      $inbox = [...$inbox, ...fresh];
      $inboxHasMore = page.has_more;
      $inboxPage = nextPage;
    } catch (e) {
      if (gen === inboxGeneration) $inboxError = String(e);
    } finally {
      if (gen === inboxGeneration) $inboxLoadingMore = false;
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
      handleProjectPage(e.payload.generation, e.payload);
    }).then((fn) => {
      unlistenProjectPage = fn;
    });

    void getVersion().then((v) => ($appVersion = v));

    // Re-hydrate row density from the backend (authoritative); the persistent
    // store already painted the last-known value on cold launch.
    void api
      .getSettings()
      .then((s) => {
        $rowDensity = resolveRowDensity(s.row_density);
        $pollIntervalSecs = s.poll_interval_secs;
      })
      .catch(() => {});

    // Mirror `$updateAvailable` into the macOS tray icon. Swaps to an
    // "octocat with down-arrow notch" silhouette + tooltip when an
    // update is pending, so users with the window closed still see
    // a signal in their menu bar.
    const unsubUpdate = updateAvailable.subscribe((u) => {
      void api
        .setTrayUpdateState(u !== null, u?.version ?? null)
        .catch((e) => console.warn("[ghtasks] set_tray_update_state failed:", e));
    });

    // Silent background update check: runs shortly after launch and
    // then every 4 hours for long-running sessions. The 2s delay is
    // just enough to let the first `fetch_all` kick off so the two
    // calls don't contend on the network; shorter than the previous
    // 5s so the avatar-dot indicator appears before a user would
    // normally open the menu.
    async function backgroundUpdateCheck() {
      try {
        const res = await api.checkForUpdates();
        if (res.available) {
          $updateAvailable = {
            version: res.version ?? "",
            body: res.body,
          };
          console.log(
            `[ghtasks] update available: v${res.version ?? "?"}`,
          );
        } else {
          $updateAvailable = null;
        }
      } catch (e) {
        console.warn("[ghtasks] update check failed:", e);
      }
    }
    setTimeout(() => {
      void backgroundUpdateCheck();
    }, 2_000);
    updateCheckHandle = setInterval(backgroundUpdateCheck, 4 * 60 * 60 * 1000);

    void refreshAuth();
    const unsubPoll = pollIntervalSecs.subscribe((seconds) => {
      if (pollHandle) clearInterval(pollHandle);
      const interval = Number.isFinite(seconds) ? Math.min(3600, Math.max(30, seconds)) : 90;
      pollHandle = setInterval(() => {
        if ($auth.authenticated && !$loading) void refresh();
      }, interval * 1000);
    });
    let wasAuthenticated = $auth.authenticated;
    const unsubAuth = auth.subscribe((status) => {
      if (wasAuthenticated && !status.authenticated) {
        refreshGeneration++;
        inboxGeneration++;
        seenItemsByGen.clear();
        $sources = [];
        $sourceResults = [];
        $projectResults = [];
        $inbox = [];
        $recentlyCreated = new Map();
        $recentlyClosed = new Map();
        $seenInboxCues = {};
        clearNewIssueDraft();
        localStorage.removeItem("ghtasks.sourceEditorDraft");
        $lastSyncAt = null;
        $lastCacheWriteAt = null;
        $inboxLastSyncAt = null;
        $inboxError = null;
        $inboxLoading = false;
        $inboxLoadingMore = false;
        $loading = false;
        $showNewIssue = false;
        $createdIssueNotice = null;
        $appView = { kind: "list" };
      }
      wasAuthenticated = status.authenticated;
    });
    window.addEventListener("keydown", onKeydown);
    return () => {
      if (pollHandle) clearInterval(pollHandle);
      if (updateCheckHandle) clearInterval(updateCheckHandle);
      if (unlistenProjectPage) unlistenProjectPage();
      unsubUpdate();
      unsubPoll();
      unsubAuth();
      window.removeEventListener("keydown", onKeydown);
    };
  });
</script>

<main class="app">
  {#if !$auth.authenticated}
    <Login onAuthed={refreshAuth} />
  {:else}
    <div class="workspace" inert={$showNewIssue ? true : null}>
    <TopBar />
    <div class="body">
      <div class="slider" class:to-detail={$appView.kind !== "list"}>
        <div
          class="pane list"
          inert={$appView.kind !== "list" ? true : null}
        >
          {#if $activeTab === "projects"}
            <ProjectList />
          {:else if $activeTab === "issues"}
            <IssueList />
          {:else if $activeTab === "inbox"}
            <InboxList onLoadMore={loadMoreInbox} onRetry={refreshInbox} />
          {:else if $activeTab === "settings"}
            <Settings onSourcesChanged={refresh} />
          {/if}
        </div>
        <div
          class="pane detail"
          inert={$appView.kind === "list" ? true : null}
        >
          {#if $appView.kind === "detail"}
            <IssueDetail
              repo={$appView.repo}
              number={$appView.number}
              onBack={() => ($appView = { kind: "list" })}
            />
          {:else if $appView.kind === "about"}
            <About onBack={() => ($appView = { kind: "list" })} />
          {/if}
        </div>
      </div>
    </div>
    <UpdateBanner />
    {#if $createdIssueNotice}
      <div class="created-notice" role="status">
        <span>Issue #{$createdIssueNotice.issue.number} created in {$createdIssueNotice.repo}</span>
        <button onclick={() => {
          if (!$createdIssueNotice) return;
          $appView = { kind: "detail", repo: $createdIssueNotice.repo, number: $createdIssueNotice.issue.number, nodeId: $createdIssueNotice.issue.node_id };
          $createdIssueNotice = null;
        }}>View issue</button>
        <button class="ghost" aria-label="Dismiss creation notice" onclick={() => ($createdIssueNotice = null)}>✕</button>
      </div>
    {/if}
    {#if $activeTab !== "settings" || $appView.kind !== "list"}
      <SyncFooter onRefresh={refresh} />
    {/if}
    </div>
    {#if $showNewIssue}
      <NewIssue onCreated={refresh} />
    {/if}
  {/if}
  {#if $lastError}
    <div class="error" role="alert" inert={$showNewIssue ? true : null}><span>{$lastError}</span><button class="ghost" aria-label="Dismiss error" onclick={() => ($lastError = null)}>✕</button></div>
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
  .workspace { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .created-notice { display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-top: 1px solid var(--border); background: var(--bg-elev); font-size: 12px; }
  .created-notice span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .created-notice button { flex-shrink: 0; padding: 4px 8px; font-size: 12px; }
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
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    background: rgba(229, 72, 77, 0.15);
    color: #ffb4b7;
    padding: 6px 10px;
    font-size: 12px;
    border-top: 1px solid rgba(229, 72, 77, 0.3);
  }
  .error span { overflow-wrap: anywhere; }
  .error button { flex-shrink: 0; padding: 2px 6px; }
  @media (prefers-reduced-motion: reduce) { .slider { transition: none; } }
</style>
