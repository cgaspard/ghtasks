<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Repo, type Settings as SettingsT } from "../api";
  import { lastError, settingsSection } from "../stores";
  import SourceEditor from "./SourceEditor.svelte";

  interface Props {
    onSourcesChanged: () => Promise<void> | void;
  }
  let { onSourcesChanged }: Props = $props();

  let settings: SettingsT = $state({
    default_repo: null,
    poll_interval_secs: 90,
    launch_at_login: false,
    window_size: "default",
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

  function toggle(section: "general" | "sources" | "about") {
    $settingsSection = $settingsSection === section ? "general" : section;
  }
</script>

<div class="wrap">
  <!-- Sources -->
  <section class="acc">
    <button class="acc-head" onclick={() => toggle("sources")}>
      <span>Sources</span>
      <span class="chev">{$settingsSection === "sources" ? "▾" : "▸"}</span>
    </button>
    {#if $settingsSection === "sources"}
      <div class="acc-body no-pad">
        <SourceEditor onChanged={onSourcesChanged} />
      </div>
    {/if}
  </section>

  <!-- General -->
  <section class="acc">
    <button class="acc-head" onclick={() => toggle("general")}>
      <span>General</span>
      <span class="chev">{$settingsSection === "general" ? "▾" : "▸"}</span>
    </button>
    {#if $settingsSection === "general"}
      <div class="acc-body">
        <label>
          Default repo for new issues
          <select bind:value={settings.default_repo} onchange={save}>
            <option value={null}>(none)</option>
            {#each repos as r}
              <option value={r.full_name}>{r.full_name}</option>
            {/each}
          </select>
        </label>

        <label>
          Window size
          <select bind:value={settings.window_size} onchange={save}>
            <option value="compact">Compact (340 × 480)</option>
            <option value="default">Default (380 × 560)</option>
            <option value="tall">Tall (380 × 760)</option>
            <option value="wide">Wide (480 × 560)</option>
            <option value="large">Large (480 × 760)</option>
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
      </div>
    {/if}
  </section>

  <!-- About -->
  <section class="acc">
    <button class="acc-head" onclick={() => toggle("about")}>
      <span>About</span>
      <span class="chev">{$settingsSection === "about" ? "▾" : "▸"}</span>
    </button>
    {#if $settingsSection === "about"}
      <div class="acc-body">
        <p class="muted small">
          GH Tasks v0.1.0 · backed by GitHub Issues + Projects · your data
          stays with GitHub.
        </p>
      </div>
    {/if}
  </section>
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
  }
  .acc {
    border-bottom: 1px solid var(--border);
  }
  .acc-head {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-radius: 0;
    color: var(--text);
    font-weight: 500;
    cursor: pointer;
  }
  .acc-head:hover {
    background: var(--bg-elev);
  }
  .chev {
    color: var(--text-dim);
    font-size: 10px;
  }
  .acc-body {
    padding: 10px 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .acc-body.no-pad {
    padding: 0;
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
