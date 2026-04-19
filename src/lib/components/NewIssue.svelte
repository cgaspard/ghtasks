<script lang="ts">
  import { api, type Repo } from "../api";
  import { activeTab, lastError } from "../stores";

  interface Props {
    onCreated: () => Promise<void> | void;
  }
  let { onCreated }: Props = $props();

  let repos: Repo[] = $state([]);
  let loadingRepos = $state(false);
  let repo = $state("");
  let title = $state("");
  let body = $state("");
  let labels = $state("");
  let issueType = $state("");
  let submitting = $state(false);

  $effect(() => {
    if (repos.length === 0 && !loadingRepos) {
      void loadRepos();
    }
  });

  async function loadRepos() {
    loadingRepos = true;
    try {
      repos = await api.listRepos();
      const defaults = await api.getSettings();
      if (defaults.default_repo) repo = defaults.default_repo;
    } catch (e) {
      $lastError = String(e);
    } finally {
      loadingRepos = false;
    }
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!repo || !title.trim() || submitting) return;
    submitting = true;
    try {
      await api.createIssue(repo, {
        title: title.trim(),
        body: body.trim() || undefined,
        labels: labels
          ? labels.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        type: issueType || undefined,
      });
      title = "";
      body = "";
      labels = "";
      issueType = "";
      await onCreated();
      $activeTab = "issues";
    } catch (e) {
      $lastError = String(e);
    } finally {
      submitting = false;
    }
  }
</script>

<form class="form" onsubmit={submit}>
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
    <textarea rows="6" bind:value={body} placeholder="Notes, checklist…"
    ></textarea>
  </label>

  <div class="row">
    <label class="grow">
      Labels (comma-separated)
      <input bind:value={labels} placeholder="bug, priority:high" />
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
    <button
      class="primary"
      type="submit"
      disabled={submitting || !repo || !title.trim()}
    >
      {submitting ? "Creating…" : "Create issue"}
    </button>
  </div>
</form>

<style>
  .form {
    padding: 10px;
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
  .row {
    display: flex;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
