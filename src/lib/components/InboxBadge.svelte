<script lang="ts">
  import type { InboxCategory } from "../api";

  // The inline amber cue on Projects/Issues rows only marks "needs a response"
  // items (review / mention / reply) — not assignments or other notifications.
  let { category }: { category: InboxCategory } = $props();

  const LABEL: Partial<Record<InboxCategory, string>> = {
    mentioned: "Mention",
    review_requested: "Review",
    participating: "Reply",
  };
  const TITLE: Partial<Record<InboxCategory, string>> = {
    mentioned: "You were mentioned",
    review_requested: "A review was requested from you",
    participating: "A new reply on a thread you're in",
  };
  const label = $derived(LABEL[category]);
  const title = $derived(TITLE[category] ?? "");
</script>

{#if label}
  <span class="await-badge" {title} data-reason={category}>
    {#if category === "mentioned"}
      <svg viewBox="0 0 16 16" aria-hidden="true"
        ><path
          d="M8 0a8 8 0 1 0 3.5 15.2.75.75 0 1 0-.66-1.35A6.5 6.5 0 1 1 14.5 8v.75a1.25 1.25 0 0 1-2.5 0V4.75a.75.75 0 0 0-1.5 0v.36A3.5 3.5 0 1 0 11 11.06a2.75 2.75 0 0 0 5-1.56V8a8 8 0 0 0-8-8Zm2 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
        /></svg
      >
    {:else if category === "participating"}
      <svg viewBox="0 0 16 16" aria-hidden="true"
        ><path
          d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-.75.75H4.56l-2.03 2.03A.75.75 0 0 1 1 13.5V2.75Z"
        /></svg
      >
    {:else}
      <svg viewBox="0 0 16 16" aria-hidden="true"
        ><path
          d="M8 2.5c-3.6 0-6.3 3-7.4 4.7a1.4 1.4 0 0 0 0 1.6C1.7 10.5 4.4 13.5 8 13.5s6.3-3 7.4-4.7a1.4 1.4 0 0 0 0-1.6C14.3 5.5 11.6 2.5 8 2.5Zm0 9A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7ZM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
        /></svg
      >
    {/if}
    <span class="lbl">{label}</span>
  </span>
{/if}

<style>
  .await-badge {
    order: -1;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 17px;
    padding: 0 6px 0 5px;
    border-radius: 9px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #f6c445;
    background: rgba(227, 160, 8, 0.13);
    border: 1px solid rgba(227, 160, 8, 0.42);
    white-space: nowrap;
  }
  .await-badge svg {
    width: 11px;
    height: 11px;
    flex: 0 0 auto;
    fill: #e3a008;
  }
</style>
