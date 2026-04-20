<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { api, type DeviceCode } from "../api";
  import { lastError } from "../stores";

  interface Props {
    onAuthed: () => Promise<void> | void;
  }
  let { onAuthed }: Props = $props();

  let device: DeviceCode | null = $state(null);
  let polling = $state(false);
  let status = $state<string>("");
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  async function start() {
    $lastError = null;
    status = "";
    try {
      await api.setAutoHide(false);
      device = await api.authStart();
      await openUrl(device.verification_uri);
      beginPolling(device);
    } catch (e) {
      $lastError = String(e);
      await api.setAutoHide(true);
    }
  }

  function beginPolling(d: DeviceCode) {
    polling = true;
    // GitHub sends an initial `interval` (usually 5s). Honor it, and reschedule
    // on every `slow_down` response (which includes a new interval in secs).
    schedulePoll(d, d.interval);
  }

  function schedulePoll(d: DeviceCode, seconds: number) {
    if (pollTimer) clearTimeout(pollTimer);
    // Add a small jitter buffer so we never undercut the server's minimum.
    const ms = Math.max(1, seconds) * 1000 + 250;
    pollTimer = setTimeout(() => runPoll(d), ms);
  }

  async function runPoll(d: DeviceCode) {
    if (!polling) return;
    try {
      const res = await api.authPoll(d.device_code);
      if (res.done) {
        stopPolling();
        status = "Signed in.";
        await api.setAutoHide(true);
        await onAuthed();
        return;
      }
      // Reschedule with GitHub's updated interval if provided, else keep current.
      const next = res.new_interval ?? d.interval;
      schedulePoll(d, next);
    } catch (e) {
      stopPolling();
      await api.setAutoHide(true);
      $lastError = String(e);
    }
  }

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
    } catch {
      // ignore
    }
  }
</script>

<div class="login" data-tauri-drag-region>
  <div class="icon">✓</div>
  <h1>GH Tasks</h1>
  <p class="muted">Sign in with GitHub to get started.</p>

  {#if !device}
    <button class="primary" onclick={start}>Sign in with GitHub</button>
    <button class="ghost quit" onclick={() => api.quit()}>Quit</button>
  {:else}
    <p class="muted small">
      Enter this code on the GitHub page that just opened:
    </p>
    <button class="code" onclick={copyCode} title="Click to copy">
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
      <p class="status">{status}</p>
    {/if}
  {/if}
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
</style>
