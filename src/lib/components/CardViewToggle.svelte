<script lang="ts">
  interface Props {
    value: "short" | "tall";
    onChange: (value: "short" | "tall") => void;
  }

  let { value, onChange }: Props = $props();
</script>

<div class="card-view-toggle" role="group" aria-label="Card layout">
  <button
    type="button"
    aria-pressed={value === "short"}
    title="Single-line items"
    onclick={() => onChange("short")}
  >
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
    Compact
  </button>
  <button
    type="button"
    aria-pressed={value === "tall"}
    title="Detailed cards"
    onclick={() => onChange("tall")}
  >
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M2 6h12M2 10h12" fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
    Expanded
  </button>
</div>

<style>
  .card-view-toggle {
    display: inline-flex;
    flex: 0 0 auto;
    gap: 2px;
    padding: 2px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 7px;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 24px;
    padding: 3px 7px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.3;
  }
  button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  button[aria-pressed="true"] {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    button { min-height: 44px; }
  }
</style>
