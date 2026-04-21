<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import {
    api,
    type Issue,
    type ProjectFetchResult,
    type ProjectItem,
    type ProjectField,
  } from "../api";
  import {
    sources,
    projectResults,
    selectedProjectSourceIds,
    selectedStatusFilters,
    customFieldFilter,
    lastError,
    showNewIssue,
    auth,
    loading,
    lastSyncAt,
    projectsOnlyMine,
  } from "../stores";
  import FilterPicker from "./FilterPicker.svelte";
  import StatusPicker from "./StatusPicker.svelte";
  import { statusColor } from "../statusColor";

  const NO_STATUS = "__none__";

  let filter = $state("");
  let commentingId: string | null = $state(null);
  let commentText = $state("");

  const myLogin = $derived($auth.user?.login ?? "");

  /** Project sources only, preserving user order. */
  const projectSources = $derived($sources.filter((s) => s.kind === "project"));

  /** Results for enabled project sources. */
  const activeResults = $derived($projectResults);

  /** Source id -> snapshot. */
  const snapshotById = $derived(
    new Map(
      activeResults
        .filter((r) => r.snapshot)
        .map((r) => [r.source_id, r.snapshot!] as const),
    ),
  );

  /** Flatten all items across selected sources, annotated with source id. */
  const allItems = $derived(
    (() => {
      const scope =
        $selectedProjectSourceIds.size === 0
          ? activeResults
          : activeResults.filter((r) =>
              $selectedProjectSourceIds.has(r.source_id),
            );
      const out: Array<{
        sourceId: string;
        item: ProjectItem;
        statusField: ProjectField | null;
        statusValue: string | null; // option_id or null for unset
        statusName: string | null;
        statusColor: string | null; // raw GitHub color enum for this option
        statusIndex: number; // position in the project's status options (Infinity = no status)
      }> = [];
      for (const r of scope) {
        if (!r.snapshot) continue;
        const status = findStatusField(r.snapshot.fields);
        for (const item of r.snapshot.items) {
          const sv = status
            ? item.field_values.find((fv) => fv.field_id === status.id)
            : null;
          const opt = status && sv?.option_id
            ? status.options.find((o) => o.id === sv.option_id)
            : null;
          const idx =
            status && sv?.option_id
              ? status.options.findIndex((o) => o.id === sv.option_id)
              : -1;
          out.push({
            sourceId: r.source_id,
            item,
            statusField: status,
            statusValue: sv?.option_id ?? null,
            statusName: sv?.text ?? null,
            statusColor: opt?.color ?? null,
            statusIndex: idx < 0 ? Number.POSITIVE_INFINITY : idx,
          });
        }
      }
      // Primary sort: status column order (as authored in the project).
      // Secondary sort: most recently updated first within a column.
      out.sort((a, b) => {
        if (a.statusIndex !== b.statusIndex) {
          return a.statusIndex - b.statusIndex;
        }
        return a.item.issue.updated_at < b.item.issue.updated_at ? 1 : -1;
      });
      return out;
    })(),
  );

  /** Unique status option labels across selected projects (plus "No Status"). */
  const statusChips = $derived(
    (() => {
      const counts = new Map<string | null, number>();
      const colors = new Map<string, string>(); // label -> GH color enum
      for (const r of activeResults) {
        if (!r.snapshot) continue;
        if (
          $selectedProjectSourceIds.size > 0 &&
          !$selectedProjectSourceIds.has(r.source_id)
        )
          continue;
        const status = findStatusField(r.snapshot.fields);
        if (status) {
          for (const opt of status.options) {
            if (opt.color && !colors.has(opt.name)) colors.set(opt.name, opt.color);
          }
        }
        for (const item of r.snapshot.items) {
          const val = status
            ? item.field_values.find((fv) => fv.field_id === status.id)
            : undefined;
          const key = val?.text ?? null; // group by name so chips merge across projects
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      // Produce stable ordering: use first project's status field options order, then No Status last.
      const firstStatus = activeResults
        .map((r) =>
          r.snapshot ? findStatusField(r.snapshot.fields) : null,
        )
        .find((f) => f);
      const ordered: Array<{
        label: string | null;
        count: number;
        color: string | null;
      }> = [];
      if (firstStatus) {
        for (const opt of firstStatus.options) {
          if (counts.has(opt.name)) {
            ordered.push({
              label: opt.name,
              count: counts.get(opt.name)!,
              color: colors.get(opt.name) ?? opt.color ?? null,
            });
            counts.delete(opt.name);
          }
        }
      }
      for (const [k, v] of counts.entries()) {
        if (k === null) continue;
        ordered.push({ label: k, count: v, color: colors.get(k) ?? null });
      }
      if (counts.has(null)) {
        ordered.push({ label: null, count: counts.get(null)!, color: null });
      }
      return ordered;
    })(),
  );

  /** Custom-filter candidate fields (single_select only, phase 1). */
  const customFilterableFields = $derived(
    (() => {
      const seen = new Map<string, ProjectField>();
      for (const r of activeResults) {
        if (!r.snapshot) continue;
        if (
          $selectedProjectSourceIds.size > 0 &&
          !$selectedProjectSourceIds.has(r.source_id)
        )
          continue;
        for (const f of r.snapshot.fields) {
          if (f.data_type !== "SINGLE_SELECT") continue;
          if (isStatusField(f)) continue;
          // Merge by field name so the same "Priority" across projects shows once.
          const key = f.name.toLowerCase();
          if (!seen.has(key)) seen.set(key, f);
        }
      }
      return Array.from(seen.values());
    })(),
  );

  const customFieldOptions = $derived(
    (() => {
      const fid = $customFieldFilter.fieldId;
      if (!fid) return [] as { id: string; name: string }[];
      // Gather all options across snapshots that share this field name.
      const target = customFilterableFields.find((f) => f.id === fid);
      if (!target) return [];
      const byName = new Map<string, string>();
      for (const r of activeResults) {
        if (!r.snapshot) continue;
        const match = r.snapshot.fields.find(
          (f) =>
            f.name.toLowerCase() === target.name.toLowerCase() &&
            f.data_type === "SINGLE_SELECT",
        );
        if (!match) continue;
        for (const o of match.options) {
          if (!byName.has(o.name)) byName.set(o.name, o.id);
        }
      }
      return Array.from(byName.entries()).map(([name, id]) => ({ id, name }));
    })(),
  );

  const filtered = $derived(
    allItems.filter(({ item, statusName }) => {
      // Assignee filter: items where I'm assigned.
      if ($projectsOnlyMine && myLogin) {
        const mine = item.issue.assignees?.some(
          (a) => a.login.toLowerCase() === myLogin.toLowerCase(),
        );
        if (!mine) return false;
      }
      // Text filter.
      if (filter.trim()) {
        const needle = filter.toLowerCase();
        const inTitle = item.issue.title.toLowerCase().includes(needle);
        const inLabel = item.issue.labels.some((l) =>
          l.name.toLowerCase().includes(needle),
        );
        if (!inTitle && !inLabel) return false;
      }
      // Status chip filter. Empty selection = "All".
      if ($selectedStatusFilters.size > 0) {
        const key = statusName ?? null;
        if (!$selectedStatusFilters.has(key)) return false;
      }
      // Custom field filter.
      if (
        $customFieldFilter.fieldId &&
        $customFieldFilter.selected.size > 0
      ) {
        const target = customFilterableFields.find(
          (f) => f.id === $customFieldFilter.fieldId,
        );
        if (target) {
          const itemVal = item.field_values.find(
            (fv) =>
              fv.field_name.toLowerCase() === target.name.toLowerCase(),
          );
          const label = itemVal?.text ?? null;
          // `selected` holds option names (so they work across projects).
          if (!label || !$customFieldFilter.selected.has(label)) return false;
        }
      }
      return true;
    }),
  );

  function findStatusField(fields: ProjectField[]): ProjectField | null {
    // Conventional name match; fall back to any single-select named "Status".
    return (
      fields.find((f) => isStatusField(f)) ?? null
    );
  }
  function isStatusField(f: ProjectField): boolean {
    return (
      f.data_type === "SINGLE_SELECT" && f.name.toLowerCase() === "status"
    );
  }

  function pickCustomField(id: string | null) {
    $customFieldFilter = { fieldId: id, selected: new Set() };
  }

  /** String-valued view of the status filter for FilterPicker (null → __none__). */
  const statusSelectedStrings = $derived(
    new Set(
      [...$selectedStatusFilters].map((v) =>
        v === null ? NO_STATUS : v,
      ),
    ),
  );

  async function open(issue: Issue) {
    await openUrl(issue.html_url);
  }

  async function changeStatus(
    sourceId: string,
    item: ProjectItem,
    statusField: ProjectField | null,
    optionId: string | null,
  ) {
    if (!statusField) return;
    const snap = snapshotById.get(sourceId);
    if (!snap) return;
    // Optimistic: update locally, then call mutation; revert on error.
    const prev = [...item.field_values];
    const newValues = item.field_values.filter(
      (fv) => fv.field_id !== statusField.id,
    );
    if (optionId) {
      const opt = statusField.options.find((o) => o.id === optionId);
      newValues.push({
        field_id: statusField.id,
        field_name: statusField.name,
        data_type: statusField.data_type,
        option_id: optionId,
        text: opt?.name ?? null,
      });
    }
    item.field_values = newValues;
    $projectResults = [...$projectResults]; // trigger reactivity

    try {
      await api.setProjectItemStatus(
        snap.project.id,
        item.item_id,
        statusField.id,
        optionId,
      );
    } catch (e) {
      item.field_values = prev;
      $projectResults = [...$projectResults];
      $lastError = String(e);
    }
  }

  async function submitComment(item: ProjectItem) {
    const body = commentText.trim();
    if (!body) return;
    try {
      await api.addIssueComment(item.repo, item.issue.number, body);
      commentText = "";
      commentingId = null;
    } catch (e) {
      $lastError = String(e);
    }
  }

  function relTime(iso: string): string {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d}d`;
    return new Date(iso).toLocaleDateString();
  }

  const sourceErrors = $derived(
    activeResults
      .filter((r) => r.error)
      .map((r) => {
        const name = projectSources.find((s) => s.id === r.source_id)?.name
          ?? r.source_id;
        return { name, error: r.error as string };
      }),
  );
</script>

<div class="wrap">
  <div class="filters">
    <input placeholder="Filter…" bind:value={filter} aria-label="Filter" />
    <button class="primary small" onclick={() => ($showNewIssue = true)}
      >+ New</button
    >
  </div>

  {#if projectSources.length > 0 || statusChips.length > 0 || customFilterableFields.length > 0}
    <div class="picker-row">
      <div class="seg" role="group" aria-label="Assignee filter">
        <button
          class="seg-btn"
          class:active={$projectsOnlyMine}
          onclick={() => ($projectsOnlyMine = true)}
          title="Only items assigned to me"
        >
          Mine
        </button>
        <button
          class="seg-btn"
          class:active={!$projectsOnlyMine}
          onclick={() => ($projectsOnlyMine = false)}
          title="Show all items in the project"
        >
          All
        </button>
      </div>

      {#if projectSources.length > 0}
        <FilterPicker
          label="Projects"
          emptyLabel="All"
          options={projectSources
            .filter((s) => s.enabled)
            .map((s) => ({
              value: s.id,
              label: s.name,
              color: s.color,
              count:
                activeResults.find((r) => r.source_id === s.id)?.snapshot
                  ?.items.length ?? 0,
            }))}
          selected={$selectedProjectSourceIds}
          onChange={(next) => ($selectedProjectSourceIds = next)}
        />
      {/if}

      {#if statusChips.length > 0}
        <FilterPicker
          label="Status"
          emptyLabel="All"
          options={statusChips.map((c) => ({
            value: c.label ?? NO_STATUS,
            label: c.label ?? "No Status",
            count: c.count,
            color: c.color ? statusColor(c.color).solid : null,
          }))}
          selected={statusSelectedStrings}
          onChange={(next) => {
            const converted: Set<string | null> = new Set(
              [...next].map((v) => (v === NO_STATUS ? null : v)),
            );
            $selectedStatusFilters = converted;
          }}
        />
      {/if}

      {#if customFilterableFields.length > 0}
        <label class="fld">
          <select
            value={$customFieldFilter.fieldId ?? ""}
            onchange={(e) =>
              pickCustomField((e.target as HTMLSelectElement).value || null)}
          >
            <option value="">Filter by…</option>
            {#each customFilterableFields as f (f.id)}
              <option value={f.id}>{f.name}</option>
            {/each}
          </select>
        </label>

        {#if $customFieldFilter.fieldId}
          <FilterPicker
            label={customFilterableFields.find(
              (f) => f.id === $customFieldFilter.fieldId,
            )?.name ?? "Field"}
            emptyLabel="Any"
            options={customFieldOptions.map((o) => ({
              value: o.name,
              label: o.name,
            }))}
            selected={$customFieldFilter.selected}
            onChange={(next) =>
              ($customFieldFilter = { ...$customFieldFilter, selected: next })}
          />
        {/if}
      {/if}
    </div>
  {/if}

  {#if sourceErrors.length > 0}
    <div class="src-errors">
      {#each sourceErrors as e}
        <div class="src-error"><strong>{e.name}:</strong> {e.error}</div>
      {/each}
    </div>
  {/if}

  {#if $loading && $lastSyncAt === null}
    <div class="empty">
      <div class="loader" aria-hidden="true"></div>
      <div class="loader-label">Loading your projects…</div>
      <div class="loader-hint muted">
        Fetching items from GitHub. This may take a few seconds on large
        boards.
      </div>
    </div>
  {:else if filtered.length === 0}
    <div class="empty">
      {#if projectSources.length === 0}
        No Project sources yet. Add one in the <strong>Sources</strong> tab.
      {:else if activeResults.length === 0}
        Hit the ↻ refresh button to load items.
      {:else}
        No items match.
      {/if}
    </div>
  {:else}
    <ul class="issues">
      {#each filtered as { sourceId, item, statusField, statusValue, statusName, statusColor: statusColorRaw } (item.item_id)}
        {@const c = statusColor(statusColorRaw)}
        <li
          class="issue"
          style="--status-solid: {c.solid}; --status-tint: {c.tint}; --status-ink: {c.ink};"
        >
          <div class="main">
            <button class="title" onclick={() => open(item.issue)}>
              {item.issue.title}
            </button>
            <div class="meta">
              <span class="repo-num"
                ><span class="repo">{item.repo}</span><span class="num"
                  >#{item.issue.number}</span
                ></span
              >
              <span class="time">{relTime(item.issue.updated_at)}</span>
              {#if item.issue.labels.length > 0}
                <span class="meta-dot">·</span>
                {#each item.issue.labels.slice(0, 4) as l}
                  <span
                    class="label"
                    style="background:#{l.color}22;border-color:#{l.color}55;color:#{l.color}"
                    >{l.name}</span
                  >
                {/each}
              {/if}
            </div>
          </div>
          <div class="right">
            {#if statusField}
              <StatusPicker
                value={statusValue}
                valueName={statusName}
                valueColor={statusColorRaw}
                options={statusField.options.map((o) => ({
                  id: o.id,
                  name: o.name,
                  color: o.color,
                }))}
                onPick={(optId) =>
                  changeStatus(sourceId, item, statusField, optId)}
              />
            {/if}
            <div class="tray">
              <button
                class="tray-btn"
                title="Add comment"
                onclick={() => {
                  commentingId =
                    commentingId === item.item_id ? null : item.item_id;
                  commentText = "";
                }}
                aria-label="Add comment">💬</button
              >
              <button
                class="tray-btn"
                title="Open on GitHub"
                onclick={() => open(item.issue)}
                aria-label="Open on GitHub">↗</button
              >
            </div>
          </div>
          {#if commentingId === item.item_id}
            <div class="comment-box">
              <textarea
                rows="2"
                placeholder="Add a comment…"
                bind:value={commentText}
              ></textarea>
              <div class="comment-actions">
                <button
                  class="ghost small"
                  onclick={() => (commentingId = null)}>Cancel</button
                >
                <button
                  class="primary small"
                  onclick={() => submitComment(item)}
                  disabled={!commentText.trim()}>Comment</button
                >
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .filters {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex: 0 0 auto;
  }
  .filters input {
    flex: 1;
  }
  .small {
    font-size: 11px;
    padding: 4px 8px;
  }
  .picker-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex: 0 0 auto;
    align-items: center;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-elev);
  }
  .seg-btn {
    all: unset;
    cursor: pointer;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-dim);
  }
  .seg-btn:hover {
    color: var(--text);
  }
  .seg-btn.active {
    background: var(--accent);
    color: white;
  }
  .fld {
    display: flex;
    align-items: center;
    font-size: 11px;
    color: var(--text-dim);
  }
  .fld select {
    width: auto;
    padding: 3px 6px;
    font-size: 11px;
    border-radius: 999px;
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--text-dim);
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .loader {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  .loader-label {
    color: var(--text);
    font-weight: 500;
    font-size: 13px;
  }
  .loader-hint {
    font-size: 11px;
    max-width: 260px;
    line-height: 1.4;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .src-errors {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: rgba(229, 72, 77, 0.08);
  }
  .src-error {
    font-size: 11px;
    color: #ffb4b7;
    line-height: 1.4;
  }
  .issues {
    list-style: none;
    margin: 0;
    padding: 0;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .issue {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px 10px;
    padding: 10px 12px 10px 14px;
    border-bottom: 1px solid var(--border);
    border-left: 3px solid transparent;
    transition: background 0.12s, border-left-color 0.12s;
  }
  .issue:hover {
    background: var(--bg-elev);
    border-left-color: var(--status-solid);
  }
  .main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }
  .title {
    all: unset;
    cursor: pointer;
    display: block;
    color: var(--text);
    font-size: 14px;
    font-weight: 500;
    line-height: 1.3;
    word-break: break-word;
  }
  .title:hover {
    color: var(--accent);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    align-items: center;
    color: var(--text-dim);
    font-size: 11px;
  }
  .repo-num {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
  }
  .repo {
    opacity: 0.85;
  }
  .num {
    margin-left: 4px;
    color: var(--text-dim);
  }
  .time {
    color: var(--text-dim);
  }
  .meta-dot {
    opacity: 0.5;
  }
  .label {
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 500;
    border: 1px solid;
    line-height: 1.5;
  }
  .tray {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .issue:hover .tray {
    opacity: 1;
  }
  .tray-btn {
    all: unset;
    cursor: pointer;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    font-size: 13px;
  }
  .tray-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .comment-box {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
  .comment-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .small {
    font-size: 11px;
    padding: 4px 8px;
  }
</style>
