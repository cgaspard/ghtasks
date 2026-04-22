<script lang="ts">
  import { onMount } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { api, type IssueDetail as IssueDetailT } from "../api";
  import { lastError } from "../stores";
  import { renderMarkdown } from "../markdown";

  interface Props {
    repo: string;
    number: number;
    /** Called when the user clicks Back (or presses Escape). */
    onBack: () => void;
  }
  let { repo, number, onBack }: Props = $props();

  let detail = $state<IssueDetailT | null>(null);
  let loading = $state(true);
  let error: string | null = $state(null);
  let refreshing = $state(false);

  async function load(showSpinner: boolean) {
    if (showSpinner) loading = true;
    else refreshing = true;
    error = null;
    try {
      detail = await api.getIssueDetail(repo, number);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  onMount(() => {
    void load(true);
  });

  function onKey(e: KeyboardEvent) {
    // Escape backs out unless the user is in an input (they'd expect it
    // to clear the input instead).
    if (e.key !== "Escape") return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    onBack();
  }

  /** Intercept clicks on rendered-markdown links so they open in the
   * system browser rather than navigating the webview away. */
  function onBodyClick(e: MouseEvent) {
    const t = (e.target as HTMLElement | null)?.closest("a");
    if (!t) return;
    const href = t.getAttribute("href");
    if (!href) return;
    e.preventDefault();
    void openUrl(href);
  }

  function relTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  // ---- Comment composer ------------------------------------------
  let commentText = $state("");
  let submittingComment = $state(false);

  async function submitComment() {
    const body = commentText.trim();
    if (!body || submittingComment || !detail) return;
    submittingComment = true;
    try {
      await api.addIssueComment(repo, number, body);
      commentText = "";
      await load(false); // silently re-fetch so new comment appears
    } catch (e) {
      $lastError = String(e);
    } finally {
      submittingComment = false;
    }
  }

  const body = $derived(renderMarkdown(detail?.issue.body));
  const stateLabel = $derived(
    detail?.issue.state === "closed" ? "Closed" : "Open",
  );
</script>

<svelte:window on:keydown={onKey} />

<div class="wrap">
  <header class="bar">
    <button class="ghost back" onclick={onBack} aria-label="Back">
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 1 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z"
        />
      </svg>
      <span>Back</span>
    </button>
    <div class="crumb">
      <span class="repo-num" title={`${repo} #${number}`}>
        <span class="repo">{repo}</span><span class="num">#{number}</span>
      </span>
    </div>
    <button
      class="ghost refresh"
      onclick={() => load(false)}
      aria-label="Refresh"
      disabled={loading || refreshing}
      class:spinning={refreshing}
      title="Refresh"
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"
        />
      </svg>
    </button>
  </header>

  {#if loading}
    <div class="empty">
      <div class="loader" aria-hidden="true"></div>
      <div class="loader-label">Loading issue…</div>
    </div>
  {:else if error}
    <div class="err">
      <div><strong>Couldn't load issue.</strong></div>
      <div class="muted small">{error}</div>
      <button class="ghost small" onclick={() => load(true)}>Retry</button>
    </div>
  {:else if detail}
    {@const issue = detail.issue}
    <div class="scroll">
      <article class="head">
        <h1 class="title">
          <span
            class="state"
            class:closed={issue.state === "closed"}
            title={stateLabel}
          >
            {stateLabel}
          </span>
          <span class="title-text">{issue.title}</span>
        </h1>
        <div class="meta">
          {#if issue.user}
            <img
              class="avatar"
              src={issue.user.avatar_url}
              alt={issue.user.login}
            />
            <span class="muted">
              <strong>{issue.user.login}</strong> opened
              {relTime(issue.created_at)}
              {#if issue.comments !== null && issue.comments > 0}
                · {issue.comments} comment{issue.comments === 1 ? "" : "s"}
              {/if}
            </span>
          {/if}
        </div>
        {#if issue.labels.length > 0}
          <div class="labels">
            {#each issue.labels as l}
              <span
                class="label"
                style="background:#{l.color}22;border-color:#{l.color}55;color:#{l.color}"
                >{l.name}</span
              >
            {/each}
          </div>
        {/if}
        {#if issue.assignees && issue.assignees.length > 0}
          <div class="assignees muted small">
            Assigned:
            {#each issue.assignees as a, i}
              {#if i > 0}, {/if}
              <img
                class="avatar xs"
                src={a.avatar_url}
                alt={a.login}
              />
              <span>{a.login}</span>
            {/each}
          </div>
        {/if}
      </article>

      <section class="body-block">
        {#if issue.body && issue.body.trim()}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="md" onclick={onBodyClick}>
            {@html body}
          </div>
        {:else}
          <div class="muted small no-body">No description provided.</div>
        {/if}
      </section>

      {#if detail.comments.length > 0}
        <section class="comments">
          <div class="comments-head muted small">
            {detail.comments.length} comment{detail.comments.length === 1
              ? ""
              : "s"}
          </div>
          {#each detail.comments as c (c.id)}
            <article class="comment">
              <header class="c-head">
                {#if c.user}
                  <img
                    class="avatar"
                    src={c.user.avatar_url}
                    alt={c.user.login}
                  />
                  <strong>{c.user.login}</strong>
                {/if}
                <span class="muted small">· {relTime(c.created_at)}</span>
                {#if c.author_association && c.author_association !== "NONE"}
                  <span class="assoc" title={c.author_association}>
                    {prettyAssociation(c.author_association)}
                  </span>
                {/if}
              </header>
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="md" onclick={onBodyClick}>
                {@html renderMarkdown(c.body)}
              </div>
            </article>
          {/each}
        </section>
      {/if}

      <section class="composer">
        <textarea
          bind:value={commentText}
          placeholder="Write a comment…"
          rows="3"
        ></textarea>
        <div class="composer-actions">
          <button
            class="ghost small"
            onclick={() => openUrl(issue.html_url)}
            title="Open on GitHub"
          >
            Open on GitHub ↗
          </button>
          <button
            class="primary small"
            onclick={submitComment}
            disabled={!commentText.trim() || submittingComment}
          >
            {submittingComment ? "Commenting…" : "Comment"}
          </button>
        </div>
      </section>
    </div>
  {/if}
</div>

<script module lang="ts">
  function prettyAssociation(a: string): string {
    switch (a) {
      case "OWNER":
        return "Owner";
      case "MEMBER":
        return "Member";
      case "COLLABORATOR":
        return "Collaborator";
      case "CONTRIBUTOR":
        return "Contributor";
      case "FIRST_TIMER":
      case "FIRST_TIME_CONTRIBUTOR":
        return "First-timer";
      default:
        return a.toLowerCase();
    }
  }
</script>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
    flex: 0 0 auto;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    font-size: 12px;
    color: var(--text);
  }
  .back:hover {
    background: var(--bg-hover);
  }
  .crumb {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--text-dim);
    text-align: center;
  }
  .repo-num {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .num {
    margin-left: 3px;
    color: var(--text-dim);
  }
  .refresh {
    padding: 4px 8px;
    color: var(--text-dim);
  }
  .refresh:hover:not(:disabled) {
    color: var(--text);
    background: var(--bg-hover);
  }
  .refresh.spinning svg {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-dim);
  }
  .loader {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  .loader-label {
    font-size: 12px;
  }
  .err {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--text);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .head {
    padding: 14px 14px 10px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.35;
    color: var(--text);
    display: flex;
    align-items: flex-start;
    gap: 8px;
    flex-wrap: wrap;
  }
  .title-text {
    flex: 1;
    min-width: 0;
  }
  .state {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    background: color-mix(in srgb, var(--ok) 20%, transparent);
    color: var(--ok);
    border: 1px solid color-mix(in srgb, var(--ok) 40%, transparent);
    margin-top: 1px;
  }
  .state.closed {
    background: color-mix(in srgb, #a371f7 20%, transparent);
    color: #c58bff;
    border-color: color-mix(in srgb, #a371f7 40%, transparent);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--border);
  }
  .avatar.xs {
    width: 14px;
    height: 14px;
  }
  .labels {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .label {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 500;
    border: 1px solid;
  }
  .assignees {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .body-block {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .no-body {
    font-style: italic;
  }
  .comments {
    display: flex;
    flex-direction: column;
  }
  .comments-head {
    padding: 10px 14px 0;
  }
  .comment {
    padding: 10px 14px 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .c-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text);
  }
  .assoc {
    font-size: 10px;
    color: var(--text-dim);
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
    text-transform: capitalize;
  }
  .composer {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--border);
  }
  .composer-actions {
    display: flex;
    gap: 6px;
    justify-content: space-between;
  }
  .small {
    font-size: 11px;
    padding: 4px 8px;
  }

  /* ---- Markdown rendering styles ---- */
  .md {
    font-size: 13px;
    line-height: 1.55;
    color: var(--text);
    word-wrap: break-word;
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4) {
    margin: 14px 0 8px;
    font-weight: 600;
    line-height: 1.3;
  }
  .md :global(h1) {
    font-size: 16px;
  }
  .md :global(h2) {
    font-size: 15px;
  }
  .md :global(h3) {
    font-size: 14px;
  }
  .md :global(h4) {
    font-size: 13px;
  }
  .md :global(p) {
    margin: 0 0 8px;
  }
  .md :global(p:last-child) {
    margin-bottom: 0;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 0 0 8px;
    padding-left: 22px;
  }
  .md :global(li) {
    margin: 2px 0;
  }
  .md :global(a) {
    color: var(--accent);
    text-decoration: none;
  }
  .md :global(a:hover) {
    text-decoration: underline;
  }
  .md :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    padding: 1px 5px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .md :global(pre) {
    margin: 8px 0;
    padding: 10px 12px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow-x: auto;
  }
  .md :global(pre code) {
    padding: 0;
    background: transparent;
    border: none;
    font-size: 12px;
  }
  .md :global(blockquote) {
    margin: 8px 0;
    padding-left: 10px;
    border-left: 3px solid var(--border);
    color: var(--text-dim);
  }
  .md :global(img) {
    max-width: 100%;
    border-radius: 4px;
    display: block;
    margin: 6px 0;
  }
  .md :global(hr) {
    margin: 12px 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
  .md :global(table) {
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 12px;
  }
  .md :global(th),
  .md :global(td) {
    padding: 4px 8px;
    border: 1px solid var(--border);
    text-align: left;
  }
  .md :global(th) {
    background: var(--bg-elev);
    font-weight: 600;
  }
  .md :global(input[type="checkbox"]) {
    margin-right: 4px;
  }
  textarea {
    background: var(--bg-elev);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    font-family: inherit;
    font-size: 12px;
    resize: vertical;
  }
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
</style>
