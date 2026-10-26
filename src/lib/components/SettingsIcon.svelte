<script lang="ts">
  let { name }: { name: "sources" | "appearance" | "notifications" | "general" | "updates" } = $props();
</script>

<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === "sources"}
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" />
  {:else if name === "appearance"}
    <path d="M3 6h5m4 0h9M3 12h11m4 0h3M3 18h2m4 0h12" /><circle cx="10" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="7" cy="18" r="2" />
  {:else if name === "notifications"}
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
  {:else if name === "general"}
    <circle cx="12" cy="12" r="4" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
  {:else}
    <circle cx="12" cy="12" r="9" /><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16.5h.01" />
  {/if}
</svg>

<style>svg { width: 19px; height: 19px; display: block; }</style>
