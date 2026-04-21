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
      // Trust the OS state over the stored flag on load — they should match,
      // but autostart may have been disabled out-of-band.
      try {
        const real = await api.autostartStatus();
        if (real !== settings.launch_at_login) {
          settings.launch_at_login = real;
        }
      } catch {
        // non-fatal
      }
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

  const sourcesOpen = $derived($settingsSection === "sources");
  const generalOpen = $derived($settingsSection === "general");
  const aboutOpen = $derived($settingsSection === "about");
</script>

<div class="wrap">
  <!-- Sources -->
  <section class="acc" class:open={sourcesOpen}>
    <button class="acc-head" onclick={() => toggle("sources")}>
      <span class="icon" aria-hidden="true">{sourcesOpen ? "−" : "+"}</span>
      <span class="acc-title">Sources</span>
      <span class="status-tag" aria-hidden="true"
        >{sourcesOpen ? "Hide" : "Show"}</span
      >
    </button>
    {#if sourcesOpen}
      <div class="acc-body no-pad">
        <SourceEditor onChanged={onSourcesChanged} />
      </div>
    {/if}
  </section>

  <!-- General -->
  <section class="acc" class:open={generalOpen}>
    <button class="acc-head" onclick={() => toggle("general")}>
      <span class="icon" aria-hidden="true">{generalOpen ? "−" : "+"}</span>
      <span class="acc-title">General</span>
      <span class="status-tag" aria-hidden="true"
        >{generalOpen ? "Hide" : "Show"}</span
      >
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
            <option value="default">Standard (380 × 560)</option>
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
        </label>

        {#if saved}
          <div class="saved">Saved</div>
        {/if}
      </div>
    {/if}
  </section>

  <!-- About -->
  <section class="acc" class:open={aboutOpen}>
    <button class="acc-head" onclick={() => toggle("about")}>
      <span class="icon" aria-hidden="true">{aboutOpen ? "−" : "+"}</span>
      <span class="acc-title">About</span>
      <span class="status-tag" aria-hidden="true"
        >{aboutOpen ? "Hide" : "Show"}</span
      >
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
    gap: 6px;
    padding: 6px;
  }
  .acc {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg);
  }
  .acc.open {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .acc-head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg-elev);
    border: none;
    border-radius: 0;
    color: var(--text);
    font-weight: 600;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    letter-spacing: 0.2px;
  }
  .acc-head:hover {
    background: var(--bg-hover);
  }
  .acc.open .acc-head {
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-elev));
    color: white;
  }
  .acc-title {
    flex: 1;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--text-dim);
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
  }
  .acc.open .icon {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .status-tag {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-dim);
  }
  .acc.open .status-tag {
    color: white;
    opacity: 0.85;
  }
  .acc-body {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--bg);
    border-top: 1px solid var(--border);
  }
  .acc-body.no-pad {
    padding: 0;
    border-top: 1px solid var(--border);
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
