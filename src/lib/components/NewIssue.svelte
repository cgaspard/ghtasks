<script lang="ts">
  import {
    api,
    type Issue,
    type Repo,
    type RepoLabel,
    type Source,
  } from "../api";
  import {
    auth,
    lastError,
    projectResults,
    recordRecentlyCreated,
    showNewIssue,
    sourceResults,
    sources,
  } from "../stores";
  import FilterPicker from "./FilterPicker.svelte";
  import StatusPicker from "./StatusPicker.svelte";

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
  let issueType = $state("Task");
  let assignToMe = $state(true);
  let statusOptionId = $state<string>("");
  let submitting = $state(false);

  const myLogin = $derived($auth.user?.login ?? "");

  /** Snapshot for the currently-selected project, if we already fetched it. */
  const selectedProjectSnapshot = $derived(
    $projectResults.find((r) => r.source_id === projectSourceId)?.snapshot ??
      null,
  );

  /** The project's Status field (single-select named "Status"). */
  const statusField = $derived(
    selectedProjectSnapshot?.fields.find(
      (f) =>
        f.data_type === "SINGLE_SELECT" &&
        f.name.toLowerCase() === "status",
    ) ?? null,
  );

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
    // When project (and therefore its Status field) changes, pre-select the
    // first option so new issues land under an active column by default.
    if (!statusField) {
      statusOptionId = "";
      return;
    }
    const stillValid = statusField.options.some((o) => o.id === statusOptionId);
    if (!stillValid) {
      statusOptionId = statusField.options[0]?.id ?? "";
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
    issueType = "Task";
    assignToMe = true;
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
      assignees: assignToMe && myLogin ? [myLogin] : undefined,
    };
    submitting = true;
    try {
      let created: Issue;
      let projectSrc:
        | (Source & { kind: "project" })
        | undefined;

      if (target === "project") {
        projectSrc = projectSources.find((s) => s.id === projectSourceId) as
          | (Source & { kind: "project" })
          | undefined;
        if (!projectSrc) {
          $lastError = "Pick a project.";
          submitting = false;
          return;
        }
        const res = await api.createIssueInProject(
          repo,
          projectSrc.project_id,
          input,
          statusField?.id,
          statusOptionId || undefined,
        );
        created = res.issue;
        const projectItem = buildProjectItem(
          created,
          repo,
          res.item_id,
          statusField?.id,
          statusOptionId || undefined,
        );
        insertProjectItem(projectSrc.id, projectItem);
        recordRecentlyCreated({
          issue: created,
          repo,
          projectSourceId: projectSrc.id,
          item: projectItem,
          createdAt: Date.now(),
        });
      } else {
        created = await api.createIssue(repo, input);
        insertOptimistically(created, undefined, repo);
        recordRecentlyCreated({
          issue: created,
          repo,
          createdAt: Date.now(),
        });
      }

      reset();
      $showNewIssue = false;
      // Don't await — let the slow snapshot fetch run in the background.
      void onCreated();
    } catch (e) {
      $lastError = String(e);
    } finally {
      submitting = false;
    }
  }

  /** Push a freshly-created Issue into a matching Repo source. */
  function insertOptimistically(
    issue: Issue,
    _projectSourceIdIgnored: string | undefined,
    repoFullName: string,
  ) {
    const targetSourceId = $sources.find(
      (s) => s.kind === "repo" && s.repo === repoFullName && s.enabled,
    )?.id;
    if (!targetSourceId) return;
    $sourceResults = $sourceResults.map((r) => {
      if (r.source_id !== targetSourceId) return r;
      if (r.issues.some((i) => i.node_id === issue.node_id)) return r;
      return { ...r, issues: [issue, ...r.issues] };
    });
  }

  /** Build a ProjectItem shell for a freshly-created issue, capturing the
   * server-assigned item_id and the chosen initial status field-value. */
  function buildProjectItem(
    issue: Issue,
    repoFullName: string,
    itemId: string,
    initialStatusFieldId?: string,
    initialStatusOptionId?: string,
  ): import("../api").ProjectItem {
    const snap = $projectResults.find((r) => r.source_id === projectSourceId)
      ?.snapshot;
    const fieldValues: import("../api").ProjectItemFieldValue[] = [];
    if (snap && initialStatusFieldId && initialStatusOptionId) {
      const field = snap.fields.find((f) => f.id === initialStatusFieldId);
      const opt = field?.options.find((o) => o.id === initialStatusOptionId);
      if (field && opt) {
        fieldValues.push({
          field_id: field.id,
          field_name: field.name,
          data_type: field.data_type,
          option_id: opt.id,
          text: opt.name,
        });
      }
    }
    return {
      item_id: itemId,
      issue,
      repo: repoFullName,
      field_values: fieldValues,
    };
  }

  /** Prepend a ProjectItem into the target project snapshot. No-op if that
   * snapshot doesn't exist yet or already has this node_id. */
  function insertProjectItem(
    projectSourceId: string,
    item: import("../api").ProjectItem,
  ) {
    $projectResults = $projectResults.map((r) => {
      if (r.source_id !== projectSourceId || !r.snapshot) return r;
      if (
        r.snapshot.items.some((it) => it.issue.node_id === item.issue.node_id)
      ) {
        return r;
      }
      return {
        ...r,
        snapshot: {
          ...r.snapshot,
          items: [item, ...r.snapshot.items],
        },
      };
    });
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

        {#if statusField}
          <label>
            Status
            <StatusPicker
              value={statusOptionId || null}
              valueName={statusField.options.find(
                (o) => o.id === statusOptionId,
              )?.name ?? null}
              valueColor={statusField.options.find(
                (o) => o.id === statusOptionId,
              )?.color ?? null}
              options={statusField.options.map((o) => ({
                id: o.id,
                name: o.name,
                color: o.color,
              }))}
              onPick={(opt) => (statusOptionId = opt ?? "")}
            />
          </label>
        {:else if !selectedProjectSnapshot}
          <div class="hint muted">
            Status options will load once the project is synced.
          </div>
        {/if}
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

      {#if myLogin}
        <label class="inline">
          <input type="checkbox" bind:checked={assignToMe} />
          Assign to me ({myLogin})
        </label>
      {/if}

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
  .form label.inline {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    color: var(--text);
    font-size: 12px;
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
  .hint {
    font-size: 11px;
    line-height: 1.4;
  }
  .muted {
    color: var(--text-dim);
  }
</style>
