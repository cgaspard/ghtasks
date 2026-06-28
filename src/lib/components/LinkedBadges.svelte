<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type { Issue, LinkedPr, PrState } from "../api";

  let { issue }: { issue: Issue } = $props();

  const prs = $derived(issue.linked_prs ?? []);

  // GitHub's PR-state palette. Color alone (no pill) makes a linked PR stand
  // out against the dim metadata line.
  const PR_COLORS: Record<PrState, string> = {
    open: "3fb950",
    merged: "a371f7",
    closed: "f85149",
  };

  function prColor(pr: LinkedPr): string {
    if (pr.is_draft && pr.state === "open") return "8b949e"; // draft → muted
    return PR_COLORS[pr.state] ?? "8b949e";
  }

  function prTitle(pr: LinkedPr): string {
    const draft = pr.is_draft ? "draft " : "";
    return `${draft}${pr.state} PR ${pr.repo}#${pr.number}: ${pr.title}`;
  }

  async function openPr(pr: LinkedPr) {
    await openUrl(pr.url);
  }
</script>

{#each prs as pr (pr.number + "@" + pr.repo)}
  <button
    class="pr"
    style="--pr:#{prColor(pr)}"
    title={prTitle(pr)}
    onclick={() => openPr(pr)}
  >
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"
      />
    </svg>
    PR #{pr.number}
  </button>
{/each}

<style>
  .pr {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    color: var(--pr);
    font-weight: 600;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .pr:hover {
    text-decoration: underline;
  }
  .pr svg {
    flex: 0 0 auto;
  }
</style>
