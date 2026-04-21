<script lang="ts">
  import { api, type ProjectSummary, type Repo, type Source } from "../api";
  import { sources, projectResults, sourceResults, lastError } from "../stores";

  interface Props {
    onChanged: () => Promise<void> | void;
  }
  let { onChanged }: Props = $props();

  type DraftKind =
    | { kind: "repo"; repo: string; query: string }
    | {
        kind: "project";
        project_id: string;
        owner_login: string;
        number: number;
        title: string;
        items_query: string;
      };

  type Draft = {
    id: string;
    name: string;
    enabled: boolean;
    color: string | null;
    notify: boolean;
  } & DraftKind;

  let repos: Repo[] = $state([]);
  let projects: ProjectSummary[] = $state([]);
  let loadingRepos = $state(false);
  let loadingProjects = $state(false);
  let editing: Draft | null = $state(null);
  let showForm = $state(false);

  async function loadRepos() {
    if (repos.length > 0) return;
    loadingRepos = true;
    try {
      repos = await api.listRepos();
    } catch (e) {
      $lastError = String(e);
    } finally {
      loadingRepos = false;
    }
  }

  async function loadProjects() {
    if (projects.length > 0) return;
    loadingProjects = true;
    try {
      projects = await api.listProjects();
    } catch (e) {
      $lastError = String(e);
    } finally {
      loadingProjects = false;
    }
  }

  const PRESETS: Array<{ label: string; q: string }> = [
    { label: "My open issues", q: "is:issue is:open assignee:@me" },
    { label: "Issues I opened", q: "is:issue is:open author:@me" },
    { label: "All open issues", q: "is:issue is:open" },
    { label: "Open bugs", q: "is:issue is:open label:bug" },
    { label: "PRs awaiting my review", q: "is:pr is:open review-requested:@me" },
  ];

  function newProjectSource() {
    editing = {
      id: "",
      name: "",
      enabled: true,
      color: "#4f8cff",
      notify: true,
      kind: "project",
      project_id: "",
      owner_login: "",
      number: 0,
      title: "",
      // Default: exclude Released to keep fetches lean. Users can change it.
      items_query: "-status:Released",
    };
    showForm = true;
    loadProjects();
  }

  function newRepoSource() {
    editing = {
      id: "",
      name: "",
      enabled: true,
      color: "#9aa0ac",
      notify: true,
      kind: "repo",
      repo: "",
      query: PRESETS[0].q,
    };
    showForm = true;
    loadRepos();
  }

  function edit(s: Source) {
    const draft = { ...s } as Draft;
    // Backfill default for older stored project sources that pre-date the
    // items_query field so the form always has a value.
    if (draft.kind === "project" && !("items_query" in draft)) {
      (draft as Draft & { kind: "project" }).items_query = "-status:Released";
    }
    editing = draft;
    showForm = true;
    if (s.kind === "repo") loadRepos();
    else loadProjects();
  }

  function cancel() {
    editing = null;
    showForm = false;
  }

  function onProjectPicked(projectId: string) {
    const p = projects.find((x) => x.id === projectId);
    if (!p || !editing || editing.kind !== "project") return;
    editing.project_id = p.id;
    editing.owner_login = p.owner_login;
    editing.number = p.number;
    editing.title = p.title;
    if (!editing.name.trim()) editing.name = p.title;
  }

  async function save() {
    if (!editing) return;
    if (editing.kind === "repo") {
      if (!editing.repo) {
        $lastError = "Pick a repository.";
        return;
      }
      if (!editing.name.trim()) {
        editing.name = `${editing.repo.split("/")[1]} (${editing.query.slice(0, 24)})`;
      }
    } else {
      if (!editing.project_id) {
        $lastError = "Pick a project.";
        return;
      }
      if (!editing.name.trim()) editing.name = editing.title;
    }
    try {
      await api.saveSource(editing as unknown as Source);
      editing = null;
      showForm = false;
      await onChanged();
    } catch (e) {
      $lastError = String(e);
    }
  }

  async function remove(id: string) {
    // Optimistic local update so the row disappears immediately; we don't
    // wait for the heavy project refresh to finish.
    const prev = $sources;
    $sources = prev.filter((s) => s.id !== id);
    $projectResults = $projectResults.filter((r) => r.source_id !== id);
    $sourceResults = $sourceResults.filter((r) => r.source_id !== id);
    try {
      await api.deleteSource(id);
      // Kick off a refresh in the background — don't await.
      void onChanged();
    } catch (e) {
      $sources = prev;
      $lastError = String(e);
    }
  }

  async function toggle(s: Source) {
    // Optimistic toggle: update the local store, then save + background refresh.
    const prev = $sources;
    $sources = prev.map((x) =>
      x.id === s.id ? { ...x, enabled: !s.enabled } : x,
    );
    try {
      await api.saveSource({ ...s, enabled: !s.enabled });
      void onChanged();
    } catch (e) {
      $sources = prev;
      $lastError = String(e);
    }
  }

  function sourceLabel(s: Source): string {
    return s.kind === "project"
      ? `Project · ${s.owner_login}/#${s.number}`
      : `Repo · ${s.repo}`;
  }
</script>

<div class="wrap">
  {#if !showForm}
    <div class="head">
      <div>Sources <span class="muted">({$sources.length})</span></div>
      <div class="add">
        <button class="primary small" onclick={newProjectSource}>+ Project</button>
        <button class="small" onclick={newRepoSource}>+ Repo</button>
      </div>
    </div>

    {#if $sources.length === 0}
      <div class="empty">
        Add a Project (recommended) or a Repo search. Projects pull issues
        straight from a GitHub Projects v2 board, with their Status.
      </div>
    {:else}
      <ul class="list">
        {#each $sources as s (s.id)}
          <li class="row" style={s.color ? `--accent-bar: ${s.color}` : ""}>
            <div class="top">
              <label class="toggle" title={s.enabled ? "Enabled" : "Disabled"}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onchange={() => toggle(s)}
                  aria-label="Enable source"
                />
              </label>
              <div class="name" title={s.name}>{s.name}</div>
              <div class="actions">
                <button class="ghost small" onclick={() => edit(s)}>Edit</button>
                <button
                  class="ghost small danger"
                  onclick={() => remove(s.id)}
                  aria-label="Delete source">✕</button
                >
              </div>
            </div>
            <div class="sub muted" title={sourceLabel(s)}>
              <code>{sourceLabel(s)}</code>
            </div>
            {#if s.kind === "repo" && s.query}
              <div class="sub muted q" title={s.query}>
                <code>{s.query}</code>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {:else if editing}
    <div class="form">
      {#if editing.kind === "project"}
        <label>
          Project
          <select
            value={editing.project_id}
            onchange={(e) =>
              onProjectPicked((e.target as HTMLSelectElement).value)}
          >
            <option value="" disabled>
              {loadingProjects ? "Loading…" : "Pick a project"}
            </option>
            {#each projects as p (p.id)}
              <option value={p.id}>
                {p.owner_login}/#{p.number} · {p.title}
              </option>
            {/each}
          </select>
        </label>

        <label>
          Name
          <input
            bind:value={editing.name}
            placeholder={editing.title || "Source name"}
          />
        </label>

        <label>
          Server-side filter
          <textarea
            rows="2"
            bind:value={editing.items_query}
            placeholder="-status:Released"
          ></textarea>
          <div class="hint muted">
            GitHub Projects filter grammar, applied on the server. Examples:
            <code>-status:Released</code>, <code>assignee:@me</code>,
            <code>updated:&gt;@today-30d</code>. Leave empty to fetch all
            items.
          </div>
        </label>
      {:else}
        <label>
          Name
          <input
            bind:value={editing.name}
            placeholder="e.g. My bugs in web-app"
          />
        </label>

        <label>
          Repository
          <select bind:value={editing.repo}>
            <option value="" disabled>
              {loadingRepos ? "Loading…" : "Pick a repository"}
            </option>
            {#each repos as r}
              <option value={r.full_name}
                >{r.full_name}{r.private ? " 🔒" : ""}</option
              >
            {/each}
          </select>
        </label>

        <label>
          Preset
          <select
            onchange={(e) =>
              editing && editing.kind === "repo"
                ? (editing.query = (e.target as HTMLSelectElement).value)
                : undefined}
          >
            <option disabled selected>Choose a preset…</option>
            {#each PRESETS as p}
              <option value={p.q}>{p.label}</option>
            {/each}
          </select>
        </label>

        <label>
          Query
          <textarea
            rows="3"
            bind:value={editing.query}
            placeholder="is:issue is:open assignee:@me"
          ></textarea>
          <div class="hint muted">
            GitHub search syntax. <code>repo:</code> is prepended automatically.
          </div>
        </label>
      {/if}

      <div class="row-inline">
        <label class="inline">
          <input type="checkbox" bind:checked={editing.enabled} /> Enabled
        </label>
        <label class="inline">
          <input type="checkbox" bind:checked={editing.notify} /> Notify on new
        </label>
        <label class="inline color">
          Color
          <input type="color" bind:value={editing.color} />
        </label>
      </div>

      <div class="actions end">
        <button class="ghost" onclick={cancel}>Cancel</button>
        <button class="primary" onclick={save}>Save</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .wrap {
    padding: 10px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    gap: 8px;
  }
  .add {
    display: flex;
    gap: 4px;
  }
  .empty {
    padding: 24px 12px;
    text-align: center;
    color: var(--text-dim);
    line-height: 1.4;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .row {
    --accent-bar: var(--accent);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent-bar);
    border-radius: var(--radius);
    margin-bottom: 6px;
    min-width: 0;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .toggle {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
  }
  .toggle input {
    width: auto;
    margin: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-left: 26px;
  }
  .sub code {
    background: transparent;
    padding: 0;
  }
  .q code {
    opacity: 0.75;
  }
  .actions {
    display: flex;
    gap: 4px;
    flex: 0 0 auto;
  }
  .actions.end {
    justify-content: flex-end;
    margin-top: 12px;
  }
  .small {
    font-size: 11px;
    padding: 3px 8px;
  }
  .danger {
    color: var(--danger);
    padding: 3px 6px;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
    gap: 6px;
    color: var(--text);
  }
  .row-inline {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    align-items: center;
  }
  .color input[type="color"] {
    width: 34px;
    padding: 0;
    height: 24px;
  }
  .hint {
    font-size: 11px;
  }
</style>
