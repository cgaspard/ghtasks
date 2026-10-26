<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { onDestroy } from "svelte";
  import { api, type DeviceCode } from "../api";
  import { lastError } from "../stores";

  interface Props {
    onAuthed: () => Promise<void> | void;
  }
  let { onAuthed }: Props = $props();

  let device: DeviceCode | null = $state(null);
  let polling = $state(false);
  let starting = $state(false);
  let error = $state("");
  let expiresAt = 0;
  let generation = 0;
  let status = $state<string>("");
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  async function start() {
    if (starting) return;
    const gen = ++generation;
    stopPolling();
    starting = true;
    $lastError = null;
    error = "";
    status = "";
    try {
      await api.setAutoHide(false);
      const next = await api.authStart();
      if (gen !== generation) return;
      device = next;
      expiresAt = Date.now() + next.expires_in * 1000;
      try { await openUrl(next.verification_uri); }
      catch { error = "Couldn’t open your browser. Use Open GitHub to enter the code."; }
      if (gen === generation) beginPolling(next, gen);
    } catch (e) {
      if (gen === generation) { device = null; error = String(e); }
      await api.setAutoHide(true).catch(() => {});
    } finally {
      if (gen === generation) starting = false;
    }
  }

  function beginPolling(d: DeviceCode, gen: number) {
    polling = true;
    // GitHub sends an initial `interval` (usually 5s). Honor it, and reschedule
    // on every `slow_down` response (which includes a new interval in secs).
    schedulePoll(d, d.interval, gen);
  }

  function schedulePoll(d: DeviceCode, seconds: number, gen: number) {
    if (pollTimer) clearTimeout(pollTimer);
    // Add a small jitter buffer so we never undercut the server's minimum.
    const ms = Math.max(1, seconds) * 1000 + 250;
    pollTimer = setTimeout(() => runPoll(d, gen), ms);
  }

  async function runPoll(d: DeviceCode, gen: number) {
    if (!polling || gen !== generation) return;
    if (Date.now() >= expiresAt) {
      stopPolling();
      error = "This code expired. Get a new code to continue.";
      return;
    }
    try {
      const res = await api.authPoll(d.device_code);
      if (gen !== generation) return;
      if (res.done) {
        stopPolling();
        status = "Signed in.";
        await api.setAutoHide(true);
        await onAuthed();
        return;
      }
      // Reschedule with GitHub's updated interval if provided, else keep current.
      const next = res.new_interval ?? d.interval;
      schedulePoll(d, next, gen);
    } catch (e) {
      if (gen !== generation) return;
      stopPolling();
      await api.setAutoHide(true).catch(() => {});
      error = `${String(e)}. Get a new code to try again.`;
    }
  }

  function cancel() {
    generation++;
    stopPolling();
    starting = false;
    device = null;
    status = "";
    error = "";
    void api.setAutoHide(true).catch(() => {});
  }
  onDestroy(() => {
    generation++;
    stopPolling();
    void api.setAutoHide(true).catch(() => {});
  });

  function stopPolling() {
    polling = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function copyCode() {
    if (!device) return;
    try {
      await navigator.clipboard.writeText(device.user_code);
      status = "Copied!";
      setTimeout(() => (status = ""), 1500);
    } catch { error = "Couldn’t copy the code. You can enter it manually on GitHub."; }
  }
</script>

<div class="login" data-tauri-drag-region>
  <div class="icon">✓</div>
  <h1>GitHub Tasks</h1>
  <p class="muted">Sign in with GitHub to get started.</p>

  {#if !device}
    <button class="primary" onclick={start} disabled={starting}>{starting ? "Starting sign-in…" : "Sign in with GitHub"}</button>
    <button class="ghost quit" onclick={() => api.quit()}>Quit</button>
  {:else}
    <p class="muted small">
      Enter this code on the GitHub page that just opened:
    </p>
    <button class="code" onclick={copyCode} title="Click to copy" aria-label={`Copy code ${device.user_code}`}>
      {device.user_code}
    </button>
    <p class="muted small">
      or visit <a href={device.verification_uri} target="_blank" rel="noopener"
        >{device.verification_uri}</a
      >
    </p>
    {#if polling}
      <p class="muted small">Waiting for approval…</p>
    {/if}
    {#if status}
      <p class="status" role="status">{status}</p>
    {/if}
    <div class="login-actions"><button onclick={() => device && openUrl(device.verification_uri).catch(() => error = "Couldn’t open GitHub. Visit github.com/login/device in your browser.")}>Open GitHub ↗</button><button onclick={start} disabled={starting}>Get a new code</button><button class="ghost" onclick={cancel}>Cancel</button></div>
  {/if}
  {#if error}<p class="login-error" role="alert">{error}</p>{/if}
</div>

<style>
  .login {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 28px;
    text-align: center;
    gap: 10px;
  }
  .icon {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: var(--accent);
    color: white;
    font-size: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 8px;
  }
  h1 {
    margin: 0;
    font-size: 20px;
  }
  .small {
    font-size: 12px;
  }
  .code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 22px;
    letter-spacing: 4px;
    padding: 10px 16px;
    background: var(--bg-elev);
  }
  .status {
    color: var(--ok);
    font-size: 12px;
  }
  .quit {
    margin-top: 6px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .login-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
  .login-actions button { font-size: 12px; }
  .login-error { color: #ffb4b7; font-size: 12px; overflow-wrap: anywhere; }
</style>
