<script lang="ts">
  import { api, type Repo, type RepoLabel, type Source } from "../api";
  import { lastError, showNewIssue, sources } from "../stores";
  import FilterPicker from "./FilterPicker.svelte";

  interface Props {
    onCreated: () => Promise<void> | void;
  }
  let { onCreated }: Props = $props();

  type Target = "project" | "repo";

  let target: Target = $state("project");
  let repo = $state("");
  let projectSourceId = $state("");
  let title = $state("");
  let body = $state("");
  let selectedLabels = $state<Set<string>>(new Set());
  let issueType = $state("");
  let submitting = $state(false);

  let repos: Repo[] = $state([]);
  let loadingRepos = $state(false);

  /** Labels available in the currently selected repo. */
  let repoLabels: RepoLabel[] = $state([]);
  let loadingLabels = $state(false);
  let lastLabelsRepo = $state("");

  const projectSources = $derived(
    $sources.filter((s) => s.kind === "project" && s.enabled),
  );

  async function loadRepos() {
    if (repos.length > 0 || loadingRepos) return;
    loadingRepos = true;
    try {
      repos = await api.listRepos();
      const defaults = await api.getSettings();
      if (!repo && defaults.default_repo) repo = defaults.default_repo;
    } catch (e) {
      $lastError = String(e);
    } finally {
      loadingRepos = false;
    }
  }

  $effect(() => {
    void loadRepos();
  });

  $effect(() => {
    // Default project when opening in project mode.
    if (target === "project" && !projectSourceId && projectSources.length > 0) {
      projectSourceId = projectSources[0].id;
    }
  });

  $effect(() => {
    // When the selected repo changes, fetch its labels. Reset prior selections
    // since a label name in repo A may not exist in repo B.
    if (!repo || repo === lastLabelsRepo) return;
    const target = repo;
    lastLabelsRepo = target;
    loadingLabels = true;
    repoLabels = [];
    selectedLabels = new Set();
    api
      .listRepoLabels(target)
      .then((ls) => {
        if (lastLabelsRepo === target) repoLabels = ls;
      })
      .catch((e) => {
        $lastError = String(e);
      })
      .finally(() => {
        if (lastLabelsRepo === target) loadingLabels = false;
      });
  });

  function close() {
    $showNewIssue = false;
    reset();
  }
  function reset() {
    title = "";
    body = "";
    selectedLabels = new Set();
    issueType = "";
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    if (!repo) {
      $lastError = "Pick a repository.";
      return;
    }
    const input = {
      title: title.trim(),
      body: body.trim() || undefined,
      labels: selectedLabels.size > 0 ? [...selectedLabels] : undefined,
      type: issueType || undefined,
    };
    submitting = true;
    try {
      if (target === "project") {
        const src = projectSources.find((s) => s.id === projectSourceId) as
          | (Source & { kind: "project" })
          | undefined;
        if (!src) {
          $lastError = "Pick a project.";
          submitting = false;
          return;
        }
        await api.createIssueInProject(repo, src.project_id, input);
      } else {
        await api.createIssue(repo, input);
      }
      reset();
      await onCreated();
      $showNewIssue = false;
    } catch (e) {
      $lastError = String(e);
    } finally {
      submitting = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window on:keydown={onKey} />

<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="New issue"
>
  <div class="modal">
    <header class="head">
      <div class="title">New issue</div>
      <button class="ghost" aria-label="Close" onclick={close}>✕</button>
    </header>

    <div class="target">
      <button
        class="seg"
        class:active={target === "project"}
        onclick={() => (target = "project")}
        disabled={projectSources.length === 0}
        title={projectSources.length === 0
          ? "Add a Project source first"
          : "Create in a project"}>Project</button
      >
      <button
        class="seg"
        class:active={target === "repo"}
        onclick={() => (target = "repo")}>Repo only</button
      >
    </div>

    <form class="form" onsubmit={submit}>
      {#if target === "project"}
        <label>
          Project
          <select bind:value={projectSourceId} required>
            <option value="" disabled>Pick a project</option>
            {#each projectSources as s (s.id)}
              <option value={s.id}>{s.name}</option>
            {/each}
          </select>
        </label>
      {/if}

      <label>
        Repository
        <select bind:value={repo} required>
          <option value="" disabled>
            {loadingRepos ? "Loading…" : "Pick a repository"}
          </option>
          {#each repos as r}
            {#if !r.archived}
              <option value={r.full_name}
                >{r.full_name}{r.private ? " 🔒" : ""}</option
              >
            {/if}
          {/each}
        </select>
      </label>

      <label>
        Title
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={title}
          placeholder="What needs to be done?"
          required
          autofocus
        />
      </label>

      <label>
        Body (markdown)
        <textarea rows="5" bind:value={body} placeholder="Notes, checklist…"
        ></textarea>
      </label>

      <div class="row">
        <label class="grow">
          Labels
          <FilterPicker
            label={loadingLabels
              ? "Loading…"
              : repoLabels.length === 0
                ? "None available"
                : "Labels"}
            emptyLabel="None"
            options={repoLabels.map((l) => ({
              value: l.name,
              label: l.name,
              color: `#${l.color}`,
            }))}
            selected={selectedLabels}
            onChange={(next) => (selectedLabels = next)}
          />
        </label>
        <label>
          Type
          <select bind:value={issueType}>
            <option value="">(none)</option>
            <option value="Task">Task</option>
            <option value="Bug">Bug</option>
            <option value="Feature">Feature</option>
          </select>
        </label>
      </div>

      <div class="actions">
        <button type="button" class="ghost" onclick={close}>Cancel</button>
        <button
          class="primary"
          type="submit"
          disabled={submitting || !repo || !title.trim()}
        >
          {submitting ? "Creating…" : "Create issue"}
        </button>
      </div>
    </form>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    z-index: 50;
  }
  .modal {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-weight: 500;
  }
  .target {
    display: flex;
    gap: 4px;
    padding: 8px 10px 0;
  }
  .seg {
    flex: 1;
    font-size: 12px;
    padding: 4px 8px;
    background: var(--bg-elev);
    color: var(--text-dim);
    border: 1px solid var(--border);
  }
  .seg.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  .seg:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .form {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 4px;
  }
</style>
