<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { api } from "../api";
  import { updateAvailable, lastError } from "../stores";

  const REPO_URL = "https://github.com/cgaspard/ghtasks";
  const DISMISS_KEY = "updateBannerDismissed";

  /** Which version was dismissed this session. Non-persistent — resets on
   * app relaunch, so users see the banner again next session (they can
   * re-dismiss if they still aren't ready). Tracked per-version so a new
   * version that lands later in the same session re-surfaces. */
  let dismissedVersion = $state<string | null>(
    sessionStorage.getItem(DISMISS_KEY),
  );

  let installing = $state(false);

  const shouldShow = $derived(
    $updateAvailable !== null && dismissedVersion !== $updateAvailable.version,
  );

  function dismiss() {
    if (!$updateAvailable) return;
    dismissedVersion = $updateAvailable.version;
    sessionStorage.setItem(DISMISS_KEY, $updateAvailable.version);
  }

  async function install() {
    if (installing) return;
    installing = true;
    try {
      await api.installUpdate();
    } catch (e) {
      $lastError = String(e);
      installing = false;
    }
  }

  function openReleaseNotes() {
    if (!$updateAvailable) return;
    void openUrl(`${REPO_URL}/releases/tag/v${$updateAvailable.version}`);
  }
</script>

{#if shouldShow && $updateAvailable}
  <div class="bar" role="status" aria-live="polite">
    <span class="dot" aria-hidden="true"></span>
    <button
      class="label"
      onclick={openReleaseNotes}
      title="Open release notes on GitHub"
    >
      Update available: <strong>v{$updateAvailable.version}</strong>
    </button>
    <button
      class="primary small install"
      onclick={install}
      disabled={installing}
    >
      {installing ? "Installing…" : "Install"}
    </button>
    <button
      class="dismiss"
      onclick={dismiss}
      aria-label="Dismiss until next app launch"
      title="Dismiss until next launch"
    >
      ✕
    </button>
  </div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: color-mix(in srgb, #f0b429 14%, var(--bg-elev));
    border-top: 1px solid color-mix(in srgb, #f0b429 35%, var(--border));
    font-size: 12px;
    color: var(--text);
    flex: 0 0 auto;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f0b429;
    box-shadow: 0 0 0 3px color-mix(in srgb, #f0b429 30%, transparent);
    flex: 0 0 auto;
  }
  .label {
    all: unset;
    flex: 1;
    min-width: 0;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label:hover {
    text-decoration: underline;
  }
  .install {
    font-size: 11px;
    padding: 3px 10px;
  }
  .dismiss {
    all: unset;
    cursor: pointer;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    color: var(--text-dim);
    font-size: 11px;
    flex: 0 0 auto;
  }
  .dismiss:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
</style>
