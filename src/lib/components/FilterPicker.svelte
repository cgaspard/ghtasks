<script lang="ts">
  import { onMount } from "svelte";

  interface Option {
    value: string;
    label: string;
    count?: number;
    color?: string | null;
  }

  interface Props {
    label: string;
    options: Option[];
    /** Selected values; empty = "all" semantically. */
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
    emptyLabel?: string;
  }

  let { label, options, selected, onChange, emptyLabel = "All" }: Props =
    $props();

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();

  function toggle(value: string) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  function clearAll() {
    onChange(new Set());
  }

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    if (root && !root.contains(e.target as Node)) open = false;
  }

  onMount(() => {
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  });

  const summary = $derived(
    selected.size === 0
      ? emptyLabel
      : selected.size === 1
        ? options.find((o) => o.value === [...selected][0])?.label ??
          `${selected.size} selected`
        : `${selected.size} selected`,
  );
</script>

<div class="picker" bind:this={root}>
  <button class="trigger" class:active={selected.size > 0} onclick={() => (open = !open)}>
    <span class="pill-label">{label}:</span>
    <span class="pill-value">{summary}</span>
    <span class="caret">▾</span>
  </button>

  {#if open}
    <div class="menu" role="menu">
      <div class="menu-head">
        <span class="menu-title">{label}</span>
        {#if selected.size > 0}
          <button class="ghost tiny" onclick={clearAll}>Clear</button>
        {/if}
      </div>
      <div class="menu-body">
        {#each options as o (o.value)}
          <label class="opt">
            <input
              type="checkbox"
              checked={selected.has(o.value)}
              onchange={() => toggle(o.value)}
            />
            {#if o.color}
              <span class="swatch" style="background:{o.color}"></span>
            {/if}
            <span class="opt-label">{o.label}</span>
            {#if o.count !== undefined}
              <span class="opt-count">{o.count}</span>
            {/if}
          </label>
        {/each}
        {#if options.length === 0}
          <div class="empty">Nothing to filter by.</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 11px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .trigger:hover {
    color: var(--text);
  }
  .trigger.active {
    color: var(--text);
    border-color: var(--accent);
  }
  .pill-label {
    font-weight: 500;
  }
  .pill-value {
    color: var(--text);
  }
  .caret {
    font-size: 9px;
    opacity: 0.7;
  }
  .menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    min-width: 200px;
    max-width: 280px;
    max-height: 280px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    z-index: 10;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .menu-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
  }
  .menu-title {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .tiny {
    font-size: 10px;
    padding: 2px 6px;
  }
  .menu-body {
    overflow: auto;
    padding: 4px 0;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .opt:hover {
    background: var(--bg-hover);
  }
  .opt input {
    margin: 0;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .opt-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .opt-count {
    font-size: 10px;
    color: var(--text-dim);
  }
  .empty {
    padding: 10px;
    font-size: 11px;
    color: var(--text-dim);
    text-align: center;
  }
</style>
