<script lang="ts">
  import { onMount } from "svelte";
  import { statusColor } from "../statusColor";

  interface Option {
    id: string;
    name: string;
    /** GitHub color enum (GREEN, YELLOW, etc.) */
    color?: string | null;
  }

  interface Props {
    value: string | null; // option id, or null = no status
    valueName: string | null;
    valueColor: string | null | undefined;
    options: Option[];
    onPick: (optionId: string | null) => void;
  }

  let { value, valueName, valueColor, options, onPick }: Props = $props();

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    if (root && !root.contains(e.target as Node)) open = false;
  }

  onMount(() => {
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  });

  const c = $derived(statusColor(valueColor));
</script>

<div class="picker" bind:this={root}>
  <button
    type="button"
    class="pill"
    class:unset={!value}
    onclick={() => (open = !open)}
    style="--status-solid: {c.solid}; --status-tint: {c.tint}; --status-ink: {c.ink};"
    title={valueName ?? "No Status"}
  >
    <span class="dot" aria-hidden="true"></span>
    <span class="label">{valueName ?? "No Status"}</span>
    <span class="caret">▾</span>
  </button>

  {#if open}
    <div class="menu" role="menu">
      <button
        type="button"
        class="opt"
        class:selected={!value}
        onclick={() => {
          onPick(null);
          open = false;
        }}
      >
        <span class="opt-dot unset" aria-hidden="true"></span>
        <span class="opt-label">No Status</span>
        {#if !value}<span class="check">✓</span>{/if}
      </button>
      {#each options as o (o.id)}
        {@const oc = statusColor(o.color)}
        <button
          type="button"
          class="opt"
          class:selected={o.id === value}
          onclick={() => {
            onPick(o.id);
            open = false;
          }}
        >
          <span
            class="opt-dot"
            style="background: {oc.solid}; box-shadow: 0 0 0 2px color-mix(in srgb, {oc.solid} 28%, transparent);"
            aria-hidden="true"
          ></span>
          <span class="opt-label">{o.name}</span>
          {#if o.id === value}<span class="check">✓</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    display: inline-flex;
  }
  .pill {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px 2px 8px;
    border-radius: 999px;
    background: var(--status-tint);
    border: 1px solid transparent;
    color: var(--status-ink);
    font-size: 11px;
    font-weight: 500;
    transition: background 0.12s, border-color 0.12s;
  }
  .pill:hover {
    border-color: var(--status-solid);
  }
  .pill.unset {
    color: var(--text-dim);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-solid);
    flex: 0 0 auto;
    box-shadow: 0 0 0 2px
      color-mix(in srgb, var(--status-solid) 28%, transparent);
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }
  .caret {
    font-size: 9px;
    opacity: 0.7;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 180px;
    max-width: 240px;
    max-height: 320px;
    overflow: auto;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    z-index: 20;
    padding: 4px 0;
  }
  .opt {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    font-size: 12px;
    color: var(--text);
  }
  .opt:hover {
    background: var(--bg-hover);
  }
  .opt.selected {
    color: var(--text);
  }
  .opt-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .opt-dot.unset {
    background: transparent;
    border: 1px dashed var(--text-dim);
    box-shadow: none;
  }
  .opt-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    font-size: 11px;
    color: var(--accent);
  }
</style>
