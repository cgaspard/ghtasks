<script lang="ts" generics="T extends string | number | null">
  import { onMount, tick } from "svelte";

  interface Option {
    value: T;
    label: string;
    sublabel?: string;
    /** Hex color or null. Renders a swatch dot left of the label. */
    color?: string | null;
    /** Rendered at the right; useful for counts or badges. */
    badge?: string | number | null;
    disabled?: boolean;
  }

  interface Props {
    value: T;
    options: Option[];
    onChange: (next: T) => void;
    placeholder?: string;
    /** If true, show a search filter at the top of the dropdown. */
    searchable?: boolean;
    /** Minimum option count above which search is auto-enabled. */
    searchThreshold?: number;
    /** Dim / unavailable state (matches native disabled select). */
    disabled?: boolean;
    /** Fixed min-width in px, override per call-site. */
    minWidth?: number;
  }

  let {
    value,
    options,
    onChange,
    placeholder = "Pick one…",
    searchable,
    searchThreshold = 10,
    disabled = false,
    minWidth = 160,
  }: Props = $props();

  let open = $state(false);
  let query = $state("");
  let highlightedIdx = $state(-1);
  let root: HTMLDivElement | undefined = $state();
  let menu: HTMLDivElement | undefined = $state();
  let searchInput: HTMLInputElement | undefined = $state();

  const shouldSearch = $derived(
    (searchable ?? options.length >= searchThreshold) && options.length > 5,
  );

  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) ||
        (o.sublabel?.toLowerCase().includes(needle) ?? false),
    );
  });

  const selectedLabel = $derived(
    options.find((o) => o.value === value)?.label ?? placeholder,
  );
  const selectedColor = $derived(options.find((o) => o.value === value)?.color);

  function toggle() {
    if (disabled) return;
    open = !open;
    if (open) {
      query = "";
      highlightedIdx = Math.max(
        0,
        options.findIndex((o) => o.value === value),
      );
      tick().then(() => {
        if (shouldSearch && searchInput) searchInput.focus();
      });
    }
  }

  function pick(o: Option) {
    if (o.disabled) return;
    onChange(o.value);
    open = false;
  }

  function onDocClick(e: MouseEvent) {
    if (!open) return;
    if (root && !root.contains(e.target as Node)) open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      open = false;
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightedIdx = Math.min(filtered.length - 1, highlightedIdx + 1);
      scrollIntoView();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightedIdx = Math.max(0, highlightedIdx - 1);
      scrollIntoView();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[highlightedIdx];
      if (o) pick(o);
      return;
    }
  }

  function scrollIntoView() {
    if (!menu) return;
    const el = menu.querySelector<HTMLElement>(
      `[data-idx="${highlightedIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }

  onMount(() => {
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

<div
  class="sel"
  class:disabled
  class:open
  style="min-width: {minWidth}px;"
  bind:this={root}
>
  <button
    type="button"
    class="trigger"
    onclick={toggle}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    {#if selectedColor}
      <span class="swatch" style="background: {selectedColor}"></span>
    {/if}
    <span class="val" class:placeholder={!options.find((o) => o.value === value)}
      >{selectedLabel}</span
    >
    <span class="caret" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="menu" role="listbox" bind:this={menu}>
      {#if shouldSearch}
        <div class="search">
          <input
            bind:this={searchInput}
            bind:value={query}
            placeholder="Filter…"
            aria-label="Filter options"
          />
        </div>
      {/if}
      <div class="opts">
        {#each filtered as o, i (o.value)}
          <button
            type="button"
            class="opt"
            class:selected={o.value === value}
            class:highlighted={i === highlightedIdx}
            class:disabled={o.disabled}
            onclick={() => pick(o)}
            onmouseenter={() => (highlightedIdx = i)}
            data-idx={i}
            role="option"
            aria-selected={o.value === value}
          >
            {#if o.color}
              <span class="swatch" style="background: {o.color}"></span>
            {/if}
            <span class="opt-body">
              <span class="opt-label">{o.label}</span>
              {#if o.sublabel}
                <span class="opt-sub">{o.sublabel}</span>
              {/if}
            </span>
            {#if o.badge !== undefined && o.badge !== null}
              <span class="opt-badge">{o.badge}</span>
            {/if}
            {#if o.value === value}<span class="check" aria-hidden="true">✓</span>{/if}
          </button>
        {/each}
        {#if filtered.length === 0}
          <div class="empty">No matches</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .sel {
    position: relative;
    display: inline-block;
    width: 100%;
  }
  .sel.disabled {
    opacity: 0.55;
    pointer-events: none;
  }
  .trigger {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    font: inherit;
    transition: border-color 0.12s;
  }
  .trigger:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  }
  .sel.open .trigger {
    border-color: var(--accent);
  }
  .val {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .val.placeholder {
    color: var(--text-dim);
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: 0 0 auto;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  }
  .caret {
    font-size: 10px;
    color: var(--text-dim);
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    max-height: 320px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    z-index: 40;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .search {
    padding: 6px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .search input {
    width: 100%;
    box-sizing: border-box;
    padding: 5px 8px;
    font-size: 12px;
    background: var(--bg-elev);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .search input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .opts {
    overflow: auto;
    padding: 4px 0;
  }
  .opt {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text);
  }
  .opt.highlighted {
    background: var(--bg-hover);
  }
  .opt.selected {
    color: var(--text);
  }
  .opt.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .opt-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .opt-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .opt-sub {
    font-size: 10px;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .opt-badge {
    font-size: 10px;
    color: var(--text-dim);
    padding: 1px 6px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 999px;
  }
  .check {
    color: var(--accent);
    font-size: 11px;
  }
  .empty {
    padding: 14px;
    text-align: center;
    font-size: 11px;
    color: var(--text-dim);
  }
</style>
