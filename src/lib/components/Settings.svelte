<script lang="ts">
  import { onMount } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import {
    api,
    resolveRowDensity,
    resolveWindowSize,
    type Repo,
    type RowDensity,
    type Settings as SettingsT,
  } from "../api";
  import { lastError, settingsSection, rowDensity } from "../stores";
  import SourceEditor from "./SourceEditor.svelte";
  import Select from "./Select.svelte";

  const DENSITY_OPTIONS: { value: RowDensity; label: string }[] = [
    { value: "compact", label: "Compact" },
    { value: "default", label: "Default" },
    { value: "comfortable", label: "Comfortable" },
    { value: "spacious", label: "Spacious" },
  ];

  interface Props {
    onSourcesChanged: () => Promise<void> | void;
  }
  let { onSourcesChanged }: Props = $props();

  let settings: SettingsT = $state({
    default_repo: null,
    poll_interval_secs: 90,
    launch_at_login: false,
    window_size: "large",
    row_density: "default",
    notifications_sync: false,
    beta_updates: false,
  });
  let repos: Repo[] = $state([]);
  let saved = $state(false);
  /** null = unknown/unchecked yet, true = allowed, false = denied in System
   * Settings. macOS never re-prompts once denied, so this drives a hint
   * pointing the user at System Settings instead of silent, permanent no-op
   * notifications. */
  let notificationsAllowed: boolean | null = $state(null);

  onMount(async () => {
    try {
      settings = await api.getSettings();
      // Normalize possibly-empty/legacy values so the controls always hold a
      // valid preset (older installs may have compact/default/tall window sizes).
      settings.row_density = resolveRowDensity(settings.row_density);
      settings.window_size = resolveWindowSize(settings.window_size);
      $rowDensity = settings.row_density;
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
    try {
      notificationsAllowed = await api.notificationPermissionStatus();
    } catch {
      // non-fatal — hint just won't show
    }
  });

  function openNotificationSettings() {
    void openUrl(
      "x-apple.systempreferences:com.apple.preference.notifications",
    );
  }

  async function save() {
    try {
      await api.saveSettings(settings);
      saved = true;
      setTimeout(() => (saved = false), 1200);
    } catch (e) {
      $lastError = String(e);
    }
  }

  function setDensity(v: RowDensity) {
    settings.row_density = v;
    $rowDensity = v; // live-apply to the lists before the save round-trips
    save();
  }

  function toggle(section: "general" | "sources") {
    $settingsSection = $settingsSection === section ? "general" : section;
  }

  const sourcesOpen = $derived($settingsSection === "sources");
  const generalOpen = $derived($settingsSection === "general");
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
          <Select
            value={settings.default_repo}
            placeholder="(none)"
            options={[
              { value: null, label: "(none)" },
              ...repos.map((r) => ({ value: r.full_name, label: r.full_name })),
            ]}
            onChange={(v) => {
              settings.default_repo = v as string | null;
              save();
            }}
          />
        </label>

        <label>
          Window size
          <Select
            value={settings.window_size}
            options={[
              { value: "large", label: "Large (480 × 760)" },
              { value: "wide", label: "Wide (480 × 560)" },
            ]}
            onChange={(v) => {
              settings.window_size = v as typeof settings.window_size;
              save();
            }}
          />
        </label>

        <label>
          Row density
          <div class="seg" role="group" aria-label="Row density">
            {#each DENSITY_OPTIONS as opt}
              <button
                type="button"
                class="seg-btn"
                class:active={settings.row_density === opt.value}
                aria-pressed={settings.row_density === opt.value}
                onclick={() => setDensity(opt.value)}>{opt.label}</button
              >
            {/each}
          </div>
        </label>

        <label>
          Poll interval (seconds)
          <input
            type="number"
            min="30"
            max="3600"
            bind:value={settings.poll_interval_secs}
            onchange={(e) => {
              // Guard against an empty/NaN field: clamp to [30, 3600] and
              // round so the Rust u64 field always gets a valid integer.
              const n = Number(e.currentTarget.value);
              settings.poll_interval_secs = Number.isFinite(n)
                ? Math.min(3600, Math.max(30, Math.round(n)))
                : 90;
              save();
            }}
          />
        </label>

        {#if notificationsAllowed === false}
          <div class="notif-warning">
            <span>
              Notifications are turned off for GH Tasks in System Settings —
              you won't get desktop alerts for new inbox items.
            </span>
            <button class="linklike" onclick={openNotificationSettings}>
              Open System Settings
            </button>
          </div>
        {/if}

        <label class="inline">
          <input
            type="checkbox"
            bind:checked={settings.launch_at_login}
            onchange={save}
          />
          Launch at login
        </label>

        <label class="inline">
          <input
            type="checkbox"
            bind:checked={settings.notifications_sync}
            onchange={save}
          />
          Sync the "needs response" indicator with GitHub
        </label>
        <div class="hint">
          When on, opening or clearing the needs-response indicator on a
          Projects/Issues item also marks its GitHub notification read. The
          Inbox tab's own "Mark read" always syncs, regardless of this
          setting.
        </div>

        <label class="inline">
          <input
            type="checkbox"
            bind:checked={settings.beta_updates}
            onchange={save}
          />
          Receive beta updates
        </label>
        <div class="hint">
          Auto-update from the beta channel — new features and fixes land here
          first, before the stable release. Betas can be rougher. Turn off to
          return to stable on the next release.
        </div>

        {#if saved}
          <div class="saved">Saved</div>
        {/if}
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
  .saved {
    color: var(--ok);
    font-size: 12px;
  }
  .hint {
    font-size: 11px;
    color: var(--text-dim);
    line-height: 1.45;
    margin-top: -4px;
  }
  .notif-warning {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(227, 160, 8, 0.13);
    border: 1px solid rgba(227, 160, 8, 0.35);
    color: #f6c445;
    font-size: 12px;
    line-height: 1.45;
  }
  .linklike {
    all: unset;
    cursor: pointer;
    color: var(--accent);
    font-size: 12px;
    font-weight: 500;
  }
  .linklike:hover {
    text-decoration: underline;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-elev);
    align-self: flex-start;
  }
  .seg-btn {
    all: unset;
    cursor: pointer;
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-dim);
  }
  .seg-btn:hover {
    color: var(--text);
  }
  .seg-btn.active {
    background: var(--accent);
    color: white;
  }
</style>
