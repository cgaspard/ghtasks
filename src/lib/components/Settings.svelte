<script lang="ts">
  import { onMount, tick } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { api, resolveRowDensity, resolveWindowSize, type Repo, type RowDensity, type Settings as SettingsT } from "../api";
  import { activeTab, appView, settingsSection, rowDensity, pollIntervalSecs, auth } from "../stores";
  import SourceEditor from "./SourceEditor.svelte";
  import Select from "./Select.svelte";
  import About from "./About.svelte";
  import SettingsIcon from "./SettingsIcon.svelte";

  let { onSourcesChanged }: { onSourcesChanged: () => Promise<void> | void } = $props();
  const pages = [
    { id: "sources", title: "Projects & repositories", hint: "Choose what appears in your task list" },
    { id: "appearance", title: "Appearance", hint: "Window height and list density" },
    { id: "notifications", title: "Notifications", hint: "Desktop alerts and GitHub read status" },
    { id: "general", title: "General", hint: "Startup, refresh and new issue defaults" },
    { id: "updates", title: "About & updates", hint: "Version, update channel and your account" },
  ] as const;
  const densities: { value: RowDensity; label: string }[] = [
    { value: "compact", label: "Compact" }, { value: "default", label: "Default" },
    { value: "comfortable", label: "Comfortable" }, { value: "spacious", label: "Spacious" },
  ];
  const refreshOptions = [
    { value: 30, label: "Every 30 seconds" }, { value: 60, label: "Every minute" },
    { value: 90, label: "Every 90 seconds" }, { value: 300, label: "Every 5 minutes" },
    { value: 900, label: "Every 15 minutes" }, { value: 0, label: "Custom interval…" },
  ];
  const initialSettings: SettingsT = { default_repo: null, poll_interval_secs: 90, launch_at_login: false, window_size: "large", row_density: "default", notifications_sync: false, beta_updates: false };
  let settings: SettingsT = $state({ ...initialSettings });
  let committed: SettingsT = $state({ ...initialSettings });
  let failed: SettingsT | null = $state(null);
  let loaded = $state(false);
  let loading = $state(false);
  let loadError = $state("");
  let saveState = $state<"idle" | "saving" | "saved" | "error">("idle");
  let saveError = $state("");
  let saveErrorBox: HTMLDivElement | undefined = $state();
  let repos: Repo[] = $state([]);
  let reposError = $state("");
  let notificationsAllowed: boolean | null = $state(null);
  let customInterval = $state(false);
  let loggingOut = $state(false);
  let accountError = $state("");
  const repoOptions = $derived([
    { value: null, label: "Ask each time" },
    ...repos.map((repo) => ({ value: repo.full_name, label: repo.full_name })),
    ...(settings.default_repo && !repos.some((repo) => repo.full_name === settings.default_repo) ? [{ value: settings.default_repo, label: settings.default_repo }] : []),
  ]);
  const page = $derived(pages.find((p) => p.id === $settingsSection));
  const disabled = $derived(!loaded || saveState === "saving");
  const notificationSettingsUrl = /Mac/i.test(navigator.platform) ? "x-apple.systempreferences:com.apple.preference.notifications" : /Win/i.test(navigator.platform) ? "ms-settings:notifications" : null;

  async function load() {
    loading = true;
    loadError = "";
    try {
      const next = await api.getSettings();
      next.row_density = resolveRowDensity(next.row_density);
      next.window_size = resolveWindowSize(next.window_size);
      try { next.launch_at_login = await api.autostartStatus(); } catch { /* Keep the stored state if the OS cannot be queried. */ }
      settings = next;
      committed = { ...next };
      $rowDensity = next.row_density;
      $pollIntervalSecs = next.poll_interval_secs;
      customInterval = !refreshOptions.some((o) => o.value === next.poll_interval_secs);
      loaded = true;
    } catch (e) { loadError = String(e); } finally { loading = false; }
  }
  async function loadRepos() {
    reposError = "";
    try { repos = await api.listRepos(); } catch (e) { reposError = String(e); }
  }
  onMount(() => {
    void load();
    void loadRepos();
    void api.notificationPermissionStatus().then((v) => notificationsAllowed = v).catch(() => {});
  });

  async function save(next: SettingsT = { ...settings }) {
    if (!loaded || saveState === "saving") return;
    saveState = "saving";
    saveError = "";
    try {
      await api.saveSettings(next);
      settings = { ...next };
      committed = { ...next };
      failed = null;
      $rowDensity = next.row_density;
      $pollIntervalSecs = next.poll_interval_secs;
      saveState = "saved";
    } catch (e) {
      failed = { ...next };
      settings = { ...committed };
      $rowDensity = committed.row_density;
      saveState = "error";
      saveError = String(e);
      await tick();
      saveErrorBox?.scrollIntoView({ block: "nearest" });
    }
  }
  function setDensity(value: RowDensity) { settings.row_density = value; void save(); }
  function setIntervalSeconds(value: number) {
    settings.poll_interval_secs = Number.isFinite(value) ? Math.min(3600, Math.max(30, Math.round(value))) : 90;
    void save();
  }
  function back() {
    if ($settingsSection !== "home") $settingsSection = "home";
    else { $activeTab = "projects"; $appView = { kind: "list" }; }
  }
  function onKey(event: KeyboardEvent) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if ((event.target as HTMLElement)?.closest(".select[aria-expanded='true'], .menu")) return;
    event.preventDefault();
    back();
  }
  async function logout() {
    if (loggingOut) return;
    loggingOut = true; accountError = "";
    try { await api.authLogout(); $auth = { authenticated: false, user: null }; }
    catch (e) { accountError = String(e); }
    finally { loggingOut = false; }
  }
</script>

<svelte:window onkeydown={onKey} />
<div class="settings-wrap">
  <header class="settings-header">
    <button class="ghost back" onclick={back}>← {$settingsSection === "home" ? "Back to tasks" : "Settings"}</button>
    <h1>{page?.title ?? "Settings"}</h1>
    <p class="muted">{page?.hint ?? "Make GitHub Tasks work for you."}</p>
  </header>
  <div class="settings-scroll">
    {#if loadError}
      <div class="error-panel" role="alert"><strong>Couldn’t load preferences</strong><p>{loadError}</p><button onclick={load} disabled={loading}>Try again</button></div>
    {/if}
    {#if $settingsSection === "home"}
      <nav class="settings-home" aria-label="Settings categories">
        {#each pages as destination}
          <button onclick={() => $settingsSection = destination.id}>
            <span class="category-icon"><SettingsIcon name={destination.id} /></span>
            <span class="category-text"><strong>{destination.title}</strong><span class="muted">{destination.hint}</span></span><span class="chevron" aria-hidden="true">›</span>
          </button>
        {/each}
      </nav>
    {:else if $settingsSection === "sources"}
      <SourceEditor onChanged={onSourcesChanged} />
    {:else}
      {#if !loaded && !loadError}<p class="muted" role="status">Loading preferences…</p>{/if}
      <fieldset disabled={disabled}>
        {#if $settingsSection === "appearance"}
          <div class="field"><span class="field-label">Window height</span><Select ariaLabel="Window height" value={settings.window_size} options={[{ value: "large", label: "Full height · 480 × 760" }, { value: "wide", label: "Compact height · 480 × 560" }]} onChange={(v) => { settings.window_size = v; void save(); }} /><p class="hint">Both options keep the same width. Compact / Expanded in the list toolbar changes the cards separately.</p></div>
          <div class="field"><span class="field-label">Row density</span><div class="seg" role="group" aria-label="Row density">{#each densities as option}<button class="seg-btn" class:active={settings.row_density === option.value} aria-pressed={settings.row_density === option.value} onclick={() => setDensity(option.value)}>{option.label}</button>{/each}</div></div>
          <div class="section-label">Live preview</div>
          <div class="density-preview" data-density={settings.row_density}><div class="preview-top"><strong>Payments: retry failed Stripe webhooks</strong><span>IN PROGRESS</span></div><p class="muted">PR #501 · acme/webapp #284 · 12m ago</p><p class="muted labels">v1.4 · bug · payments</p></div>
        {:else if $settingsSection === "notifications"}
          <section class="notice" class:warning={notificationsAllowed === false}>
            <h2>{notificationsAllowed === false ? "Desktop notifications are turned off" : notificationsAllowed === true ? "Desktop notifications are allowed" : "Desktop notification permission"}</h2>
            <p>{notificationsAllowed === false ? "Allow GitHub Tasks in your system notification settings to receive desktop alerts." : "New review requests, mentions and replies can appear as desktop alerts."}</p>
            {#if notificationSettingsUrl}<button onclick={() => openUrl(notificationSettingsUrl)}>Open notification settings</button>{:else}<p class="hint">Manage notification permissions in your desktop’s system settings.</p>{/if}
          </section>
          <h2 class="section-heading">GitHub read status</h2>
          <label class="toggle-row"><span>Mark notifications read when I open an item<span class="hint">Opening or clearing a needs-response cue in Projects or Todos also marks its GitHub notification read.</span></span><input type="checkbox" bind:checked={settings.notifications_sync} onchange={() => save()} /></label>
          <p class="hint">Inbox’s “Mark read” always updates GitHub, whatever this setting.</p>
          <h2 class="section-heading">Repository alerts</h2><p class="muted">Choose alerts for new matching issues inside each repository connection.</p><button class="link-button" onclick={() => $settingsSection = "sources"}>Manage repository alerts →</button>
        {:else if $settingsSection === "general"}
          <div class="field"><span class="field-label">Default repository for new issues</span><Select ariaLabel="Default repository for new issues" value={settings.default_repo} placeholder="Ask each time" options={repoOptions} onChange={(v) => { settings.default_repo = v; void save(); }} />{#if reposError}<p class="hint" role="alert">Couldn’t load repositories. <button class="link-button" onclick={loadRepos}>Retry</button></p>{/if}</div>
          <div class="field"><span class="field-label">Refresh automatically</span><Select ariaLabel="Refresh automatically" value={customInterval ? 0 : settings.poll_interval_secs} options={refreshOptions} onChange={(v) => { customInterval = v === 0; if (v !== 0) setIntervalSeconds(v); }} />{#if customInterval}<label class="custom-interval">Interval in seconds<input type="number" min="30" max="3600" value={settings.poll_interval_secs} onchange={(e) => setIntervalSeconds(Number(e.currentTarget.value))} /></label><p class="hint">Choose between 30 and 3,600 seconds.</p>{/if}</div>
          <label class="toggle-row"><span>Open GitHub Tasks when I sign in<span class="hint">Keep your tasks one click away in the menu bar or system tray.</span></span><input type="checkbox" bind:checked={settings.launch_at_login} onchange={() => save()} /></label>
        {:else if $settingsSection === "updates"}
          <label class="toggle-row"><span>Receive beta updates<span class="hint">Try features before the stable release. Betas may be less reliable. Turning this off returns you to stable when a newer stable version is released.</span></span><input type="checkbox" bind:checked={settings.beta_updates} onchange={() => save()} /></label>
        {/if}
      </fieldset>
      {#if $settingsSection === "updates"}
        {#key committed.beta_updates}<About embedded onBack={back} />{/key}
        <section class="account"><h2 class="section-heading">GitHub account</h2>{#if $auth.user}<div class="account-row"><img src={$auth.user.avatar_url} alt="" /><span><strong>{$auth.user.name ?? $auth.user.login}</strong><span class="muted">@{$auth.user.login}</span></span><button onclick={logout} disabled={loggingOut}>{loggingOut ? "Signing out…" : "Sign out"}</button></div>{/if}{#if accountError}<p class="error-panel" role="alert">Couldn’t sign out: {accountError}</p>{/if}</section>
      {/if}
    {/if}
    {#if saveState === "error"}<div class="error-panel" role="alert" bind:this={saveErrorBox}><strong>Couldn’t save your change</strong><p>{saveError}</p><p>Your previous preference is still active.</p>{#if failed}<button onclick={() => failed && save(failed)}>Retry change</button>{/if}</div>{/if}
  </div>
  <footer role="status">{$settingsSection === "sources" ? "Connection changes apply when you save." : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Change not saved" : "Preferences save automatically"}</footer>
</div>

<style>
  .settings-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); }
  .settings-header { flex-shrink: 0; padding: 14px 20px 12px; border-bottom: 1px solid var(--border); }
  .back { border: 0; padding: 4px 0; color: var(--text-dim); margin-bottom: 8px; font-size: 12px; }
  h1 { font-size: 20px; line-height: 1.3; font-weight: 500; margin: 0; }
  .settings-header p { margin: 5px 0 0; font-size: 12px; }
  .settings-scroll { flex: 1; min-height: 0; overflow: auto; padding: 16px 20px; }
  .settings-home { display: flex; flex-direction: column; }
  .settings-home button { display: flex; align-items: center; gap: 12px; width: 100%; padding: 15px 0; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; text-align: left; background: transparent; }
  .settings-home button:last-child { border-bottom: 0; }
  .category-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 9px; background: var(--bg-elev); color: var(--text-dim); font-size: 19px; flex-shrink: 0; }
  .category-text { flex: 1; min-width: 0; display: grid; gap: 4px; }
  .category-text strong { font-weight: 500; font-size: 14px; }
  .category-text .muted { font-size: 12px; }
  .chevron { color: var(--text-dim); font-size: 21px; }
  fieldset { padding: 0; margin: 0; border: 0; min-width: 0; }
  .field { display: grid; gap: 7px; margin-bottom: 22px; }
  .field-label { font-weight: 500; }
  .hint { display: block; margin: 5px 0 0; color: var(--text-dim); font-size: 12px; line-height: 1.5; }
  .custom-interval { display: grid; gap: 5px; margin-top: 8px; color: var(--text-dim); font-size: 12px; }
  .seg { display: flex; flex-wrap: wrap; gap: 5px; }
  .seg-btn { font-size: 12px; padding: 6px 9px; }
  .seg-btn.active { border-color: var(--accent); background: var(--accent-dim); color: var(--text); }
  .section-label { color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: .6px; margin-bottom: 8px; }
  .density-preview { padding: 12px; border: 1px solid var(--border); border-left: 2px solid #d4a72c; border-radius: 8px; background: var(--bg-elev); }
  .density-preview[data-density="compact"] { padding: 7px 10px; font-size: 12px; }
  .density-preview[data-density="compact"] .labels { display: none; }
  .density-preview[data-density="comfortable"] { padding: 17px; font-size: 14px; }
  .density-preview[data-density="spacious"] { padding: 22px; font-size: 15px; }
  .preview-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .preview-top strong { font-weight: 500; }
  .preview-top > span { color: #d4a72c; font-size: 10px; white-space: nowrap; }
  .density-preview p { font-size: 11px; margin: 5px 0 0; }
  .toggle-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 15px 0; border-bottom: 1px solid var(--border); }
  .toggle-row input { margin: 3px 0 0; flex-shrink: 0; width: 18px; height: 18px; }
  .section-heading { margin: 22px 0 12px; padding: 8px 10px; font-size: 14px; font-weight: 500; border-left: 3px solid var(--accent); background: var(--bg-elev); border-radius: 0 6px 6px 0; }
  .notice { padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev); }
  .notice h2 { font-size: 14px; font-weight: 500; margin: 0; }
  .notice p { font-size: 12px; line-height: 1.5; margin: 7px 0; }
  .notice.warning { background: rgba(227,160,8,.1); border-color: rgba(227,160,8,.4); color: #f6c445; }
  .notice button { font-size: 12px; margin-top: 4px; }
  .link-button { border: 0; background: transparent; padding: 5px 0; color: var(--accent); font-size: 12px; }
  .error-panel { margin: 12px 0; padding: 12px; background: rgba(229,72,77,.1); border: 1px solid var(--danger); border-radius: 8px; font-size: 12px; }
  .error-panel p { margin: 6px 0; overflow-wrap: anywhere; }
  footer { flex-shrink: 0; border-top: 1px solid var(--border); padding: 10px 20px; color: var(--text-dim); font-size: 11px; }
  .account-row { display: flex; align-items: center; gap: 10px; }
  .account-row img { width: 30px; height: 30px; border-radius: 50%; }
  .account-row > span { display: grid; gap: 3px; flex: 1; }
  .account-row .muted { font-size: 12px; }
  @media (max-width: 380px) { .settings-header { padding-left: 14px; padding-right: 14px; } .settings-scroll { padding-left: 14px; padding-right: 14px; } .seg-btn { flex: 1; } }
</style>
