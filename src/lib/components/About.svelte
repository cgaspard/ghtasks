<script lang="ts">
  import { onMount } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { api } from "../api";
  import { appVersion, lastError, updateAvailable } from "../stores";

  interface Props {
    onBack: () => void;
  }
  let { onBack }: Props = $props();

  const REPO_URL = "https://github.com/cgaspard/ghtasks";

  let checkingUpdate = $state(false);
  let updateStatus = $state<
    | { kind: "idle" }
    | { kind: "current" }
    | { kind: "available"; version: string; body: string | null }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function checkForUpdates() {
    if (checkingUpdate) return;
    checkingUpdate = true;
    updateStatus = { kind: "idle" };
    try {
      const res = await api.checkForUpdates();
      if (res.available) {
        updateStatus = {
          kind: "available",
          version: res.version ?? "",
          body: res.body,
        };
        // Also publish to the app-wide store so the avatar badge and
        // "Update to vX" menu row appear. Without this the About panel
        // knows about the update but the rest of the UI doesn't.
        $updateAvailable = {
          version: res.version ?? "",
          body: res.body,
        };
      } else {
        updateStatus = { kind: "current" };
        $updateAvailable = null;
      }
    } catch (e) {
      updateStatus = { kind: "error", message: String(e) };
    } finally {
      checkingUpdate = false;
    }
  }

  async function installUpdate() {
    try {
      await api.installUpdate();
    } catch (e) {
      $lastError = String(e);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    onBack();
  }

  onMount(() => {
    // Kick off an automatic check as soon as About opens — so the
    // version status reflects reality when the user first looks.
    void checkForUpdates();
  });
</script>

<svelte:window on:keydown={onKey} />

<div class="wrap">
  <header class="bar">
    <button class="ghost back" onclick={onBack} aria-label="Back">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 1 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z"
        />
      </svg>
      <span>Back</span>
    </button>
    <div class="crumb">About</div>
    <div class="pad" aria-hidden="true"></div>
  </header>

  <div class="scroll">
    <section class="hero">
      <div class="app-name">GH Tasks</div>
      <div class="version">v{$appVersion ?? "…"}</div>
      <p class="tag muted">
        A fast, keyboard-friendly GitHub Issues + Projects task list for
        your menu bar. Backed by GitHub — no backend, no telemetry, your
        data stays with GitHub.
      </p>
    </section>

    <section class="card">
      <div class="card-title">Updates</div>
      {#if updateStatus.kind === "idle" && !checkingUpdate}
        <div class="muted small">Ready to check.</div>
      {:else if checkingUpdate}
        <div class="row-flex">
          <div class="dot pulse"></div>
          <span class="muted small">Checking for updates…</span>
        </div>
      {:else if updateStatus.kind === "current"}
        <div class="row-flex">
          <div class="dot ok"></div>
          <span class="small">You're on the latest version.</span>
        </div>
      {:else if updateStatus.kind === "available"}
        <div class="row-flex">
          <div class="dot alert"></div>
          <span class="small">
            <strong>v{updateStatus.version}</strong> is available.
          </span>
        </div>
        {#if updateStatus.body}
          <details class="notes">
            <summary>Release notes</summary>
            <pre class="notes-body">{updateStatus.body}</pre>
          </details>
        {/if}
        <div class="actions">
          <button class="primary small" onclick={installUpdate}>
            Download &amp; install
          </button>
          <button
            class="ghost small"
            onclick={() => openUrl(`${REPO_URL}/releases/tag/v${(updateStatus as { version: string }).version}`)}
          >
            View on GitHub ↗
          </button>
        </div>
      {:else if updateStatus.kind === "error"}
        <div class="row-flex">
          <div class="dot err"></div>
          <span class="small muted">Couldn't check: {updateStatus.message}</span>
        </div>
      {/if}
      <div class="inline-row">
        <button
          class="ghost small"
          onclick={checkForUpdates}
          disabled={checkingUpdate}
        >
          {checkingUpdate ? "Checking…" : "Check again"}
        </button>
      </div>
    </section>

    <section class="card">
      <div class="card-title">Links</div>
      <button class="linklike" onclick={() => openUrl(REPO_URL)}>
        GitHub repository ↗
      </button>
      <button
        class="linklike"
        onclick={() =>
          openUrl(`${REPO_URL}/releases/tag/v${$appVersion ?? ""}`)}
        disabled={!$appVersion}
      >
        Release notes for this version ↗
      </button>
      <button
        class="linklike"
        onclick={() => openUrl(`${REPO_URL}/issues/new`)}
      >
        Report an issue ↗
      </button>
      <button
        class="linklike"
        onclick={() => openUrl(`${REPO_URL}/releases`)}
      >
        All releases ↗
      </button>
    </section>

    <section class="card">
      <div class="card-title">How it works</div>
      <p class="muted small">
        GH Tasks signs in via GitHub's device-code OAuth flow. Your token
        lives in the OS keychain (<code>com.cgaspard.ghtasks</code>) and
        never leaves your machine except to reach
        <code>api.github.com</code>. Projects v2 boards sync via GraphQL;
        repo issues via REST search. Auto-poll runs every 90 seconds.
      </p>
    </section>

    <section class="footer muted">
      <span>Built with Tauri, Svelte, and Rust.</span>
    </section>
  </div>
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
    flex: 0 0 auto;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    font-size: 12px;
    color: var(--text);
  }
  .back:hover {
    background: var(--bg-hover);
  }
  .crumb {
    flex: 1;
    text-align: center;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .pad {
    width: 60px; /* mirror the Back button width so title is centered */
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 8px 0 4px;
    gap: 4px;
  }
  .app-name {
    font-size: 18px;
    font-weight: 600;
    color: var(--text);
  }
  .version {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: var(--text-dim);
  }
  .tag {
    font-size: 12px;
    line-height: 1.5;
    margin: 6px 0 0;
    max-width: 320px;
  }
  .card {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-dim);
    margin-bottom: 2px;
  }
  .row-flex {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-dim);
  }
  .dot.ok {
    background: var(--ok);
  }
  .dot.alert {
    background: #f0b429;
    box-shadow: 0 0 0 3px color-mix(in srgb, #f0b429 25%, transparent);
  }
  .dot.err {
    background: var(--danger);
  }
  .dot.pulse {
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
  }
  .notes {
    margin-top: 2px;
  }
  .notes summary {
    cursor: pointer;
    font-size: 11px;
    color: var(--accent);
  }
  .notes-body {
    margin: 6px 0 0;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--text-dim);
    max-height: 200px;
    overflow: auto;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .inline-row {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .small {
    font-size: 12px;
  }
  .linklike {
    all: unset;
    cursor: pointer;
    color: var(--accent);
    font-size: 12px;
    padding: 2px 0;
    width: fit-content;
  }
  .linklike:hover {
    text-decoration: underline;
  }
  .linklike:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .linklike:disabled:hover {
    text-decoration: none;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    padding: 1px 4px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .footer {
    text-align: center;
    font-size: 10px;
    padding: 6px 0 2px;
  }
</style>
