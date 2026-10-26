<script lang="ts">
  import { onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { api, type ProjectSummary, type Repo, type Source } from "../api";
  import { persistent } from "../persistentStore";
  import { sources, projectResults, sourceResults, settingsFocus } from "../stores";
  import Select from "./Select.svelte";

  let { onChanged }: { onChanged: () => Promise<void> | void } = $props();
  const draftStore = persistent<Source | null>("sourceEditorDraft", null);
  let editing: Source | null = $state(get(draftStore));
  let kindDrafts: Partial<Record<"project" | "repo", Source>> = {};
  let repos: Repo[] = $state([]);
  let projects: ProjectSummary[] = $state([]);
  let loadingRepos = $state(false);
  let loadingProjects = $state(false);
  let repoError = $state("");
  let projectError = $state("");
  let error = $state("");
  let errorBox: HTMLDivElement | undefined = $state();
  let success = $state("");
  let saving = $state(false);
  let confirmingRemoval = $state(false);
  let pendingIds: Set<string> = $state(new Set());
  const projectOptions = $derived([
    ...projects.map((project) => ({ value: project.id, label: project.title, sublabel: `${project.owner_login} · #${project.number}` })),
    ...(editing?.kind === "project" && editing.project_id && !projects.some((project) => editing?.kind === "project" && project.id === editing.project_id) ? [{ value: editing.project_id, label: editing.title, sublabel: `${editing.owner_login} · #${editing.number}` }] : []),
  ]);
  const repoOptions = $derived([
    ...repos.map((repo) => ({ value: repo.full_name, label: repo.full_name, sublabel: repo.description ?? undefined })),
    ...(editing?.kind === "repo" && editing.repo && !repos.some((repo) => editing?.kind === "repo" && repo.full_name === editing.repo) ? [{ value: editing.repo, label: editing.repo, sublabel: undefined }] : []),
  ]);
  const PRESETS = [
    { label: "My open issues", q: "is:issue is:open assignee:@me" },
    { label: "Open Tasks", q: "is:issue is:open type:Task" },
    { label: "Issues I opened", q: "is:issue is:open author:@me" },
    { label: "All open issues", q: "is:issue is:open" },
    { label: "Open bugs", q: "is:issue is:open label:bug" },
    { label: "PRs awaiting my review", q: "is:pr is:open review-requested:@me" },
  ];
  $effect(() => { draftStore.set(editing ? { ...editing } : null); });

  function showError(message: string) {
    error = message;
    void tick().then(() => errorBox?.scrollIntoView({ block: "nearest" }));
  }

  async function loadRepos() {
    if (loadingRepos) return;
    loadingRepos = true; repoError = "";
    try { repos = await api.listRepos(); } catch (e) { repoError = String(e); } finally { loadingRepos = false; }
  }
  async function loadProjects() {
    if (loadingProjects) return;
    loadingProjects = true; projectError = "";
    try {
      projects = await api.listProjects();
      console.log(`[ghtasks] list_projects returned ${projects.length} project(s)`, projects.map((p) => `${p.owner_login}/#${p.number} ${p.title}`));
    } catch (e) { projectError = String(e); } finally { loadingProjects = false; }
  }
  function newSource(kind: "project" | "repo") {
    if (editing?.kind === kind) return;
    if (editing && !editing.id) kindDrafts[editing.kind] = { ...editing };
    const common = { id: "", name: "", enabled: true, color: kind === "project" ? "#4f8cff" : "#9aa0ac", notify: kind === "repo" };
    const retained = kindDrafts[kind];
    editing = retained ? { ...retained } : kind === "project" ? { ...common, kind, project_id: "", owner_login: "", number: 0, title: "", items_query: "-status:Released" } : { ...common, kind, repo: "", query: PRESETS[0].q };
    error = ""; success = ""; confirmingRemoval = false;
    if (kind === "project") void loadProjects(); else void loadRepos();
  }
  onMount(() => {
    const focus = get(settingsFocus);
    if (!editing && focus) newSource(focus === "new-project" ? "project" : "repo");
    else if (editing?.kind === "project") void loadProjects();
    else if (editing?.kind === "repo") void loadRepos();
    if (focus) settingsFocus.set(null);
  });
  function edit(source: Source) {
    editing = { ...source };
    confirmingRemoval = false; error = ""; success = "";
    if (source.kind === "project") void loadProjects(); else void loadRepos();
  }
  function cancel() { if (saving) return; editing = null; kindDrafts = {}; error = ""; confirmingRemoval = false; }
  function onProjectPicked(projectId: string) {
    const project = projects.find((p) => p.id === projectId);
    if (!project || editing?.kind !== "project") return;
    editing.project_id = project.id; editing.owner_login = project.owner_login;
    editing.number = project.number; editing.title = project.title;
    if (!editing.name.trim()) editing.name = project.title;
  }
  async function refresh() {
    try { await onChanged(); } catch (e) { showError(`Connection saved, but refresh failed: ${String(e)}`); }
  }
  async function save() {
    if (!editing || saving) return;
    error = "";
    if (editing.kind === "project" && !editing.project_id) { showError("Choose a project board."); return; }
    if (editing.kind === "repo" && !editing.repo) { showError("Choose a repository."); return; }
    const source = { ...editing };
    if (!source.name.trim()) source.name = source.kind === "project" ? source.title : `${source.repo.split("/").at(-1)} · ${PRESETS.find((p) => p.q === source.query)?.label ?? "Custom search"}`;
    saving = true;
    try {
      const saved = await api.saveSource(source);
      const exists = $sources.some((s) => s.id === saved.id);
      $sources = exists ? $sources.map((s) => s.id === saved.id ? saved : s) : [...$sources, saved];
      editing = null; kindDrafts = {}; success = "Connection saved.";
      void refresh();
    } catch (e) { showError(`Couldn’t save connection: ${String(e)}`); } finally { saving = false; }
  }
  async function remove(source: Source) {
    if (saving) return;
    saving = true; error = "";
    try {
      await api.deleteSource(source.id);
      $sources = $sources.filter((s) => s.id !== source.id);
      $projectResults = $projectResults.filter((r) => r.source_id !== source.id);
      $sourceResults = $sourceResults.filter((r) => r.source_id !== source.id);
      editing = null; confirmingRemoval = false; success = "Connection removed. Your GitHub items are kept.";
      void refresh();
    } catch (e) { showError(`Couldn’t remove connection: ${String(e)}`); } finally { saving = false; }
  }
  async function toggle(source: Source) {
    if (pendingIds.has(source.id)) return;
    pendingIds = new Set([...pendingIds, source.id]); error = "";
    try {
      const saved = await api.saveSource({ ...source, enabled: !source.enabled });
      $sources = $sources.map((s) => s.id === saved.id ? saved : s);
      void refresh();
    } catch (e) { showError(`Couldn’t update connection: ${String(e)}`); } finally { pendingIds = new Set([...pendingIds].filter((id) => id !== source.id)); }
  }
</script>

<div class="source-editor">
  {#if !editing}
    <div class="head"><h2>Your connections <span class="muted">{$sources.length}</span></h2><button class="primary" onclick={() => newSource("project")}>+ Add connection</button></div>
    {#if !$sources.length}<div class="empty"><h3>Bring your GitHub work here</h3><p>Connect a project board for Projects, or a repository for Todos.</p><button onclick={() => newSource("repo")}>Connect a repository</button></div>{/if}
    <ul class="list">
      {#each $sources as source (source.id)}
        <li class="connection" style:--connection-color={source.color ?? "var(--text-dim)"}>
          <div class="connection-copy"><strong>{source.name}</strong><p class="muted">{source.kind === "project" ? `${source.owner_login} · Project #${source.number}` : source.repo}</p><label class="connection-state"><input type="checkbox" checked={source.enabled} disabled={pendingIds.has(source.id)} onchange={() => toggle(source)} aria-label={`Show ${source.name} in my task list`} /><span>{pendingIds.has(source.id) ? "Saving…" : source.enabled ? "Active" : "Paused"}</span></label></div>
          <button class="manage" onclick={() => edit(source)} aria-label={`Manage ${source.name}`}>Manage</button>
        </li>
      {/each}
    </ul>
    <p class="hint">Project boards appear in Projects. Repository searches appear in Todos.</p>
  {:else}
    <form onsubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={saving}>
        <h2>{editing.id ? "Manage connection" : "Add a connection"}</h2>
        {#if !editing.id}<div class="kind-options" role="group" aria-label="Connection type"><button type="button" class:active={editing.kind === "project"} aria-pressed={editing.kind === "project"} onclick={() => newSource("project")}>Project board</button><button type="button" class:active={editing.kind === "repo"} aria-pressed={editing.kind === "repo"} onclick={() => newSource("repo")}>Repository</button></div>{/if}
        {#if editing.kind === "project"}
          <div class="field"><span class="field-label">Project board</span><Select ariaLabel="Project board" value={editing.project_id} placeholder={loadingProjects ? "Loading projects…" : "Choose a project board"} disabled={loadingProjects} options={projectOptions} onChange={(v) => onProjectPicked(v)} />
          {#if projectError}<div class="inline-error" role="alert">Couldn’t load projects: {projectError}<button type="button" onclick={loadProjects}>Retry</button></div>{:else if !loadingProjects && !projects.length}<p class="hint">No projects are visible to this GitHub account.</p>{/if}
          <details class="help"><summary>Can’t find your project?</summary><p>Check organization approval and SSO access for GitHub Tasks, then retry. You may need your organization administrator’s approval.</p><div class="help-actions"><button type="button" onclick={() => openUrl("https://github.com/settings/applications")}>Open GitHub authorization settings ↗</button><button type="button" onclick={loadProjects}>Retry projects</button></div></details></div>
          <p class="notice">Items appear in Projects with their status. Released items are hidden by default.</p>
        {:else}
          <div class="field"><span class="field-label">Repository</span><Select ariaLabel="Repository" value={editing.repo} placeholder={loadingRepos ? "Loading repositories…" : "Choose a repository"} disabled={loadingRepos} options={repoOptions} onChange={(v) => { if (editing?.kind === "repo") editing.repo = v; }} />
          {#if repoError}<div class="inline-error" role="alert">Couldn’t load repositories: {repoError}<button type="button" onclick={loadRepos}>Retry</button></div>{:else if !loadingRepos && !repos.length}<p class="hint">No repositories are visible. Check the account’s access on GitHub, then <button type="button" class="link-button" onclick={loadRepos}>retry</button>.</p>{/if}</div>
          <div class="field"><span class="field-label">Which issues?</span><Select ariaLabel="Which issues?" value={editing.query} placeholder="Custom search" options={PRESETS.map((p) => ({ value: p.q, label: p.label }))} onChange={(v) => { if (editing?.kind === "repo") editing.query = v; }} /></div>
        {/if}
        <label class="field">Display name<input bind:value={editing.name} placeholder={editing.kind === "project" ? editing.title || "Use the project name" : "Use the repository name"} /></label>
        <details class="advanced"><summary>More options</summary><div class="advanced-body">
          {#if editing.kind === "project"}<label class="field">Filter project items<textarea aria-label="Filter project items" rows="2" bind:value={editing.items_query}></textarea><span class="hint">Use GitHub Projects filter syntax, such as <code>-status:Released</code>. Leave empty to fetch all items.</span></label>{:else}<label class="field">Custom GitHub search<textarea aria-label="Custom GitHub search" rows="3" bind:value={editing.query}></textarea><span class="hint">Use GitHub search syntax. This connection’s repository is added automatically.</span></label><label class="inline"><input type="checkbox" bind:checked={editing.notify} /><span>Desktop alerts for new matching issues<span class="hint">Separate from review, mention and reply alerts.</span></span></label>{/if}
          <label class="color">Connection color<input type="color" value={editing.color ?? "#4f8cff"} oninput={(event) => { if (editing) editing.color = event.currentTarget.value; }} /></label>
        </div></details>
        {#if editing.id}<label class="inline enabled"><input type="checkbox" bind:checked={editing.enabled} /><span>Show in my task list<span class="hint">Turn off to pause this connection without removing it.</span></span></label><details class="advanced remove"><summary>Remove connection</summary><div class="advanced-body"><p>Remove this connection from GitHub Tasks. Your issues and project on GitHub are kept.</p>{#if confirmingRemoval}<div class="remove-confirm" role="group" aria-label="Confirm removing connection"><strong>Remove {editing.name}?</strong><div class="actions"><button type="button" onclick={() => confirmingRemoval = false}>Keep connection</button><button type="button" class="danger" onclick={() => editing && remove(editing)}>Remove connection</button></div></div>{:else}<button type="button" class="danger" onclick={() => confirmingRemoval = true}>Remove connection</button>{/if}</div></details>{/if}
        <div class="actions form-actions"><button type="button" class="ghost" onclick={cancel}>Cancel</button><button type="submit" class="primary">{saving ? "Saving…" : editing.id ? "Save changes" : editing.kind === "project" ? "Add project" : "Add repository"}</button></div>
      </fieldset>
      <p class="hint">Connection changes apply when you save. Your draft is kept until you save or cancel.</p>
    </form>
  {/if}
  {#if error}<div class="inline-error" role="alert" bind:this={errorBox}>{error}</div>{/if}
  {#if success}<p class="success" role="status">{success}</p>{/if}
</div>

<style>
  .source-editor { min-width: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  h2 { margin: 0; font-size: 14px; font-weight: 500; }
  .head h2 .muted { font-size: 12px; margin-left: 4px; }
  .head button { font-size: 12px; }
  .list { list-style: none; padding: 0; margin: 0; }
  .connection { display: flex; align-items: flex-start; gap: 10px; padding: 14px 0 14px 11px; border-bottom: 1px solid var(--border); border-left: 2px solid var(--connection-color); }
  .connection-copy { flex: 1; min-width: 0; }
  .connection-copy strong { font-weight: 500; overflow-wrap: anywhere; }
  .connection-copy p { font-size: 12px; margin: 5px 0; overflow-wrap: anywhere; }
  .connection-state { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim); }
  .connection-state input { margin: 0; }
  .manage { font-size: 12px; }
  .empty { text-align: center; padding: 30px 12px; }
  .empty h3 { font-size: 14px; font-weight: 500; }
  .empty p { color: var(--text-dim); font-size: 12px; line-height: 1.5; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  form h2 { margin-bottom: 16px; }
  .kind-options { display: flex; gap: 6px; margin-bottom: 20px; }
  .kind-options button { flex: 1; font-size: 12px; }
  .kind-options .active { color: var(--text); border-color: var(--accent); background: var(--accent-dim); }
  .field { display: grid; gap: 6px; margin-bottom: 18px; font-size: 12px; color: var(--text); }
  .field-label { font-weight: 500; }
  .hint { display: block; color: var(--text-dim); font-size: 12px; line-height: 1.5; margin: 10px 0; }
  .notice { padding: 12px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px; font-size: 12px; line-height: 1.5; margin: 0 0 18px; }
  .help { font-size: 12px; margin-top: 5px; color: var(--text-dim); }
  .help summary { cursor: pointer; color: var(--accent); }
  .help p { line-height: 1.5; }
  .help-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .help-actions button { font-size: 11px; }
  .advanced { border: 1px solid var(--border); border-radius: 8px; margin: 14px 0; background: var(--bg-elev); }
  .advanced > summary { padding: 12px; cursor: pointer; font-weight: 500; font-size: 12px; }
  .advanced-body { padding: 14px 12px; border-top: 1px solid var(--border); }
  .advanced-body p { font-size: 12px; line-height: 1.5; }
  .inline { display: flex; align-items: flex-start; gap: 9px; font-size: 12px; }
  .inline input { flex-shrink: 0; margin-top: 3px; }
  .inline .hint { margin: 4px 0 0; }
  .enabled { padding: 14px 0; border-bottom: 1px solid var(--border); }
  .color { display: grid; gap: 7px; margin-top: 18px; font-size: 12px; }
  .color input { width: 40px; height: 30px; border-radius: 5px; border: 1px solid var(--border); background: var(--bg); padding: 2px; }
  .actions { display: flex; justify-content: flex-end; gap: 7px; flex-wrap: wrap; }
  .form-actions { margin-top: 22px; }
  .danger { color: #ffb4b7; border-color: var(--danger); }
  .remove-confirm { display: grid; gap: 12px; font-size: 12px; }
  .inline-error { margin: 10px 0; padding: 10px; border: 1px solid var(--danger); border-radius: 7px; color: #ffb4b7; font-size: 12px; overflow-wrap: anywhere; }
  .inline-error button { display: block; margin-top: 8px; font-size: 12px; }
  .success { color: var(--ok); font-size: 12px; }
  .link-button { color: var(--accent); border: 0; padding: 0; background: transparent; }
</style>
