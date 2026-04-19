<script lang="ts">
  import { api, type Repo, type Source } from "../api";
  import { sources, lastError } from "../stores";

  interface Props {
    onChanged: () => Promise<void> | void;
  }
  let { onChanged }: Props = $props();

  let repos: Repo[] = $state([]);
  let loadingRepos = $state(false);
  let editing: Source | null = $state(null);
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

  const PRESETS: Array<{ label: string; q: string }> = [
    { label: "My open issues", q: "is:issue is:open assignee:@me" },
    { label: "Issues I opened", q: "is:issue is:open author:@me" },
    { label: "Tasks assigned to me", q: "is:issue is:open assignee:@me type:Task" },
    { label: "All open issues", q: "is:issue is:open" },
    { label: "Open bugs", q: "is:issue is:open label:bug" },
    { label: "PRs awaiting my review", q: "is:pr is:open review-requested:@me" },
  ];

  function newSource() {
    editing = {
      id: "",
      name: "",
      repo: "",
      query: PRESETS[0].q,
      enabled: true,
      color: "#4f8cff",
      notify: true,
    };
    showForm = true;
    loadRepos();
  }

  function edit(s: Source) {
    editing = { ...s };
    showForm = true;
    loadRepos();
  }

  function cancel() {
    editing = null;
    showForm = false;
  }

  async function save() {
    if (!editing) return;
    if (!editing.repo) {
      $lastError = "Pick a repository.";
      return;
    }
    if (!editing.name.trim()) {
      editing.name = `${editing.repo.split("/")[1]} (${editing.query.slice(0, 24)})`;
    }
    try {
      await api.saveSource(editing);
      editing = null;
      showForm = false;
      await onChanged();
    } catch (e) {
      $lastError = String(e);
    }
  }

  async function remove(id: string) {
    try {
      await api.deleteSource(id);
      await onChanged();
    } catch (e) {
      $lastError = String(e);
    }
  }

  async function toggle(s: Source) {
    try {
      await api.saveSource({ ...s, enabled: !s.enabled });
      await onChanged();
    } catch (e) {
      $lastError = String(e);
    }
  }
</script>

<div class="wrap">
  {#if !showForm}
    <div class="head">
      <div>Sources <span class="muted">({$sources.length})</span></div>
      <button class="primary small" onclick={newSource}>+ Add</button>
    </div>

    {#if $sources.length === 0}
      <div class="empty">
        Add a Source to start pulling issues. Each Source is a repository plus a
        GitHub search query.
      </div>
    {:else}
      <ul class="list">
        {#each $sources as s (s.id)}
          <li class="row">
            <input
              type="checkbox"
              checked={s.enabled}
              onchange={() => toggle(s)}
              aria-label="Enable source"
            />
            <div class="info">
              <div class="name">{s.name}</div>
              <div class="sub muted">
                <code>{s.repo}</code> · <code class="q">{s.query}</code>
              </div>
            </div>
            <div class="actions">
              <button class="ghost small" onclick={() => edit(s)}>Edit</button>
              <button class="ghost small danger" onclick={() => remove(s.id)}
                >Del</button
              >
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if editing}
    <div class="form">
      <label>
        Name
        <input bind:value={editing.name} placeholder="e.g. My bugs in web-app" />
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
            (editing!.query = (e.target as HTMLSelectElement).value)}
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
  }
  .empty {
    padding: 24px 12px;
    text-align: center;
    color: var(--text-dim);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 6px;
  }
  .info {
    flex: 1;
    min-width: 0;
  }
  .name {
    font-weight: 500;
  }
  .sub {
    font-size: 11px;
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .q {
    opacity: 0.85;
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  .actions.end {
    justify-content: flex-end;
    margin-top: 12px;
  }
  .small {
    font-size: 11px;
    padding: 4px 8px;
  }
  .danger {
    color: var(--danger);
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
