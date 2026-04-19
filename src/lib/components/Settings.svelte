<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Repo, type Settings } from "../api";
  import { lastError } from "../stores";

  let settings: Settings = $state({
    default_repo: null,
    poll_interval_secs: 90,
    launch_at_login: false,
  });
  let repos: Repo[] = $state([]);
  let saved = $state(false);

  onMount(async () => {
    try {
      settings = await api.getSettings();
      repos = await api.listRepos();
    } catch (e) {
      $lastError = String(e);
    }
  });

  async function save() {
    try {
      await api.saveSettings(settings);
      saved = true;
      setTimeout(() => (saved = false), 1200);
    } catch (e) {
      $lastError = String(e);
    }
  }
</script>

<div class="wrap">
  <h3>Settings</h3>

  <label>
    Default repo for new issues
    <select
      bind:value={settings.default_repo}
      onchange={save}
    >
      <option value={null}>(none)</option>
      {#each repos as r}
        <option value={r.full_name}>{r.full_name}</option>
      {/each}
    </select>
  </label>

  <label>
    Poll interval (seconds)
    <input
      type="number"
      min="30"
      max="3600"
      bind:value={settings.poll_interval_secs}
      onchange={save}
    />
  </label>

  <label class="inline">
    <input
      type="checkbox"
      bind:checked={settings.launch_at_login}
      onchange={save}
    />
    Launch at login
    <span class="muted small">(coming soon)</span>
  </label>

  {#if saved}
    <div class="saved">Saved</div>
  {/if}

  <h3>About</h3>
  <p class="muted small">
    GH Tasks v0.1.0 · backed by GitHub Issues · your data stays with GitHub.
  </p>
</div>

<style>
  .wrap {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  h3 {
    margin: 8px 0 0;
    font-size: 13px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  label.inline {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--text);
  }
  .small {
    font-size: 11px;
  }
  .saved {
    color: var(--ok);
    font-size: 12px;
  }
</style>
