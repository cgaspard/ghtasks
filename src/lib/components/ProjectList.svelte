<script lang="ts">
  import { tick } from "svelte";
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
    activeTab,
    settingsSection,
    settingsFocus,
    appView,
    rowDensity,
    seenInboxCues,
    inboxByKey,
    cardViews,
  } from "../stores";
  import FilterPicker from "./FilterPicker.svelte";
  import StatusPicker from "./StatusPicker.svelte";
  import Select from "./Select.svelte";
  import LinkedBadges from "./LinkedBadges.svelte";
  import InboxBadge from "./InboxBadge.svelte";
  import CardViewToggle from "./CardViewToggle.svelte";
  import { statusColor } from "../statusColor";

  const NO_STATUS = "__none__";

  let filter = $state("");
  let commentingId: string | null = $state(null);
  let commentText = $state("");
  let commentSubmitting = $state(false);
  let collapsedGroups = $state(new Set<string>());

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
            statusName: opt?.name ?? sv?.text ?? (sv?.option_id ? "Unknown status" : null),
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
        const at = a.item.issue.updated_at;
        const bt = b.item.issue.updated_at;
        if (at !== bt) return at < bt ? 1 : -1;
        // Deterministic tiebreaker so equal timestamps don't reorder between
        // renders (a two-valued comparator violates sort's antisymmetry).
        return a.item.item_id < b.item.item_id ? -1 : 1;
      });
      return out;
    })(),
  );

  const shortGroups = $derived.by(() => {
    const groups = new Map<string, {
      key: string;
      name: string;
      color: string | null;
      projectName: string;
      sourceIndex: number;
      statusIndex: number;
      items: typeof filtered;
    }>();
    for (const row of filtered) {
      const key = `${row.sourceId}:${row.statusValue ?? NO_STATUS}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          name: row.statusName ?? "No Status",
          color: row.statusColor,
          projectName: projectSources.find((source) => source.id === row.sourceId)?.name
            ?? snapshotById.get(row.sourceId)?.project.title ?? "Project",
          sourceIndex: activeResults.findIndex((result) => result.source_id === row.sourceId),
          statusIndex: row.statusIndex,
          items: [],
        };
        groups.set(key, group);
      }
      group.items.push(row);
    }
    return [...groups.values()].sort((a, b) => {
      if (a.sourceIndex !== b.sourceIndex) return a.sourceIndex - b.sourceIndex;
      if (a.statusIndex !== b.statusIndex) return a.statusIndex - b.statusIndex;
      if (a.name === "No Status" && b.name !== "No Status") return 1;
      if (b.name === "No Status" && a.name !== "No Status") return -1;
      return 0;
    });
  });

  const multipleGroupedProjects = $derived.by(() => new Set(filtered.map((row) => row.sourceId)).size > 1);

  function toggleGroup(key: string) {
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsedGroups = next;
  }

  async function focusShortStatus(itemId: string) {
    if ($cardViews.projects !== "short") return;
    await tick();
    document.querySelector<HTMLButtonElement>(
      `[data-project-item="${CSS.escape(itemId)}"] .short-status button`,
    )?.focus();
  }

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

  /** Lowercased name of the active custom-filter field, resolved by id.
   * Used so item matching (which is name-based) survives a stale field id. */
  const customFieldFilterName = $derived(
    customFilterableFields
      .find((f) => f.id === $customFieldFilter.fieldId)
      ?.name.toLowerCase() ?? null,
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
      // Text filter. A lone "#" (or empty filter) is not a query.
      const needle = filter.trim().toLowerCase();
      const hashed = needle.startsWith("#");
      const numNeedle = hashed ? needle.slice(1) : needle;
      if (needle && !(numNeedle === "" && hashed)) {
        // A "#"-prefixed number is an explicit, exact issue-number search; a
        // bare number prefix-matches the number AND also tries title/label.
        const numeric = /^\d+$/.test(numNeedle);
        const num = String(item.issue.number);
        const numMatch = numeric && (hashed ? num === numNeedle : num.startsWith(numNeedle));
        const textMatch =
          !(numeric && hashed) &&
          (item.issue.title.toLowerCase().includes(needle) ||
            item.issue.labels.some((l) =>
              l.name.toLowerCase().includes(needle),
            ));
        if (!numMatch && !textMatch) return false;
      }
      // Status chip filter. Empty selection = "All".
      if ($selectedStatusFilters.size > 0) {
        const key = statusName ?? null;
        if (!$selectedStatusFilters.has(key)) return false;
      }
      // Custom field filter. `customFieldFilterName` resolves the active
      // field by id; if the id has gone stale a self-healing $effect clears
      // the filter, so here we simply skip when it can't be resolved.
      if (customFieldFilterName && $customFieldFilter.selected.size > 0) {
        const itemVal = item.field_values.find(
          (fv) => fv.field_name.toLowerCase() === customFieldFilterName,
        );
        const label = itemVal?.text ?? null;
        // `selected` holds option names (so they work across projects).
        if (!label || !$customFieldFilter.selected.has(label)) return false;
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

  $effect(() => {
    // Self-heal a stale custom filter: if a field id is set but no longer
    // resolves to a visible filterable field (e.g. its project was removed),
    // clear it so it can't linger as a phantom active selection.
    if (
      $customFieldFilter.fieldId &&
      customFilterableFields.length > 0 &&
      !customFilterableFields.some((f) => f.id === $customFieldFilter.fieldId)
    ) {
      pickCustomField(null);
    }
  });

  /** String-valued view of the status filter for FilterPicker (null → __none__). */
  const statusSelectedStrings = $derived(
    new Set(
      [...$selectedStatusFilters].map((v) =>
        v === null ? NO_STATUS : v,
      ),
    ),
  );

  /** Opening an item (in browser or the detail view) marks it seen, clearing
   * its awaiting flag until a newer event arrives. Optimistically drop it from
   * the local awaiting set so the indicator vanishes immediately. */
  function markSeen(issue: Issue) {
    const notification = $inboxByKey.get(issue.node_id);
    if (!notification) return;
    const notificationId = notification.issue.node_id;
    const before = $seenInboxCues[notificationId];
    $seenInboxCues = { ...$seenInboxCues, [notificationId]: notification.event_at };
    void api
      .markInboxSeen(notificationId, new Date().toISOString())
      .catch((e) => {
        const next = { ...$seenInboxCues };
        if (before) next[notificationId] = before;
        else delete next[notificationId];
        $seenInboxCues = next;
        $lastError = `Couldn’t update the notification: ${String(e)}`;
      });
  }

  async function open(issue: Issue) {
    markSeen(issue);
    await openUrl(issue.html_url);
  }

  function goAddProject() {
    settingsFocus.set("new-project");
    $settingsSection = "sources";
    $activeTab = "settings";
  }

  function drillIn(item: ProjectItem) {
    if (!item.repo) return;
    markSeen(item.issue);
    $appView = {
      kind: "detail",
      repo: item.repo,
      number: item.issue.number,
      nodeId: item.issue.node_id,
    };
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
    const destinationKey = `${sourceId}:${optionId ?? NO_STATUS}`;
    if (collapsedGroups.has(destinationKey)) {
      collapsedGroups = new Set([...collapsedGroups].filter((key) => key !== destinationKey));
    }
    $projectResults = [...$projectResults]; // trigger reactivity
    void focusShortStatus(item.item_id);

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
      void focusShortStatus(item.item_id);
    }
  }

  async function submitComment(item: ProjectItem) {
    const body = commentText.trim();
    if (!body || commentSubmitting) return;
    commentSubmitting = true;
    try {
      await api.addIssueComment(item.repo, item.issue.number, body);
      commentText = "";
      commentingId = null;
    } catch (e) {
      $lastError = String(e);
    } finally {
      commentSubmitting = false;
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
    <input
      placeholder="Filter by title, label, or #number…"
      bind:value={filter}
      aria-label="Filter items"
    />
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
          <Select
            value={$customFieldFilter.fieldId ?? ""}
            placeholder="Filter by…"
            minWidth={130}
            options={[
              { value: "", label: "Filter by…" },
              ...customFilterableFields.map((f) => ({
                value: f.id,
                label: f.name,
              })),
            ]}
            onChange={(v) => pickCustomField(((v as string) || "") || null)}
          />
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

  {#if projectSources.length > 0}
    <div class="view-row">
      <span class="result-count" role="status" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? "issue" : "issues"}{#if $cardViews.projects === "short"} · Grouped by status{/if}
      </span>
      <CardViewToggle
        value={$cardViews.projects}
        onChange={(value) => cardViews.update((views) => ({ ...views, projects: value }))}
      />
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
  {:else if projectSources.length === 0}
    <div class="empty cta">
      <div class="cta-icon" aria-hidden="true">📋</div>
      <div class="cta-title">Add your first Project</div>
      <div class="cta-body">
        GitHub Tasks shows items from GitHub <strong>Projects v2</strong>
        boards — with their Status, assignees, labels, and inline status
        changes. Pick a board you already use (team roadmap, personal
        tracker, sprint board) and its items stream in.
      </div>
      <button class="primary cta-btn" onclick={goAddProject}>
        + Add a Project
      </button>
      <div class="cta-hint muted">
        Prefer tracking a repo's issues instead?
        Add a <strong>Repo</strong> source in
        <button class="linklike" onclick={() => {
          $settingsSection = 'sources';
          $activeTab = 'settings';
        }}>Settings → Sources</button>.
      </div>
    </div>
  {:else if filtered.length === 0}
    <div class="empty">
      {#if activeResults.length === 0}
        Hit the ↻ refresh button to load items.
      {:else}
        No items match.
      {/if}
    </div>
  {:else if $cardViews.projects === "short"}
    <div class="short-groups" data-card-view="short">
      {#each shortGroups as group, index (group.key)}
        {@const c = statusColor(group.color)}
        <section
          class="status-group"
          style="--status-solid: {c.solid};"
          aria-label={multipleGroupedProjects ? `${group.projectName}: ${group.name}` : group.name}
          data-status={group.name}
        >
          <button
            type="button"
            class="group-heading"
            aria-expanded={!collapsedGroups.has(group.key)}
            aria-controls={`project-status-group-${index}`}
            onclick={() => toggleGroup(group.key)}
          >
            <span class="group-dot" aria-hidden="true"></span>
            <span class="group-name">{group.name}</span>
            {#if multipleGroupedProjects}<span class="group-project">{group.projectName}</span>{/if}
            <span class="group-count">{group.items.length}</span>
            <span class="group-chevron" aria-hidden="true">{collapsedGroups.has(group.key) ? "▸" : "▾"}</span>
          </button>
          <ul
            id={`project-status-group-${index}`}
            class="short-items"
            hidden={collapsedGroups.has(group.key)}
          >
            {#each group.items as { sourceId, item, statusField, statusValue, statusName, statusColor: statusColorRaw } (item.item_id)}
              {@const rowColor = statusColor(statusColorRaw)}
              <li
                class="short-issue"
                data-project-item={item.item_id}
                style="--status-solid: {rowColor.solid};"
              >
                <button
                  type="button"
                  class="short-title"
                  title={`${item.issue.title} — ${item.repo} #${item.issue.number}`}
                  onclick={() => open(item.issue)}
                >{item.issue.title}</button>
                <span class="short-number">#{item.issue.number}</span>
                {#if statusField}
                  <div class="short-status">
                    <StatusPicker
                      variant="tag"
                      ariaLabel={`Change status for ${item.issue.title}`}
                      value={statusValue}
                      valueName={statusName}
                      valueColor={statusColorRaw}
                      options={statusField.options.map((option) => ({ id: option.id, name: option.name, color: option.color }))}
                      onPick={(optionId) => changeStatus(sourceId, item, statusField, optionId)}
                    />
                  </div>
                {/if}
                <button
                  type="button"
                  class="short-detail"
                  aria-label={`View issue: ${item.issue.title}`}
                  title="View issue"
                  onclick={() => drillIn(item)}
                >›</button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {:else}
    <ul class="issues" data-density={$rowDensity}>
      {#each filtered as { sourceId, item, statusField, statusValue, statusName, statusColor: statusColorRaw } (item.item_id)}
        {@const c = statusColor(statusColorRaw)}
        {@const inboxItem = $inboxByKey.get(item.issue.node_id)}
        {@const awaitItem =
          inboxItem &&
          (inboxItem.category === "review_requested" ||
            inboxItem.category === "mentioned" ||
            inboxItem.category === "participating")
            ? inboxItem
            : undefined}
        <li
          class="issue"
          class:awaiting={awaitItem}
          style="--status-solid: {c.solid}; --status-tint: {c.tint}; --status-ink: {c.ink};"
        >
          {#if awaitItem}
            <span class="awaiting-dot" aria-hidden="true"></span>
            <span class="sr">Awaiting your response</span>
          {/if}
          <div class="row1">
            {#if awaitItem}<InboxBadge category={awaitItem.category} />{/if}
            <button class="title" onclick={() => open(item.issue)}>
              {item.issue.title}
            </button>
            <div class="row1-right">
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
                <button
                  class="tray-btn drill"
                  title="View issue"
                  onclick={() => drillIn(item)}
                  aria-label="View issue"
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z"
                    />
                  </svg>
                </button>
              </div>
              {#if statusField}
                <StatusPicker
                  variant="tag"
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
            </div>
          </div>
          <div class="row2">
            <LinkedBadges issue={item.issue} />
            {#if (item.issue.linked_prs?.length ?? 0) > 0}<span class="sep"
                >·</span
              >{/if}
            <span class="repo-num"
              ><span class="repo">{item.repo}</span><span class="num"
                >#{item.issue.number}</span
              ></span
            >
            <span class="sep">·</span>
            <span class="time">{relTime(item.issue.updated_at)}</span>
            {#if item.issue.labels.length > 0}
              <span class="sep compact-only">·</span>
              <span class="row2-labels compact-only"
                >{item.issue.labels.map((l) => l.name).join(", ")}</span
              >
            {/if}
          </div>
          {#if item.issue.labels.length > 0 || item.issue.milestone}
            <div class="row3">
              {#if item.issue.milestone}
                <button
                  class="milestone"
                  title={`Milestone: ${item.issue.milestone.title}`}
                  onclick={() => openUrl(item.issue.milestone!.url)}
                >
                  {item.issue.milestone.title}
                </button>
              {/if}
              {#each item.issue.labels.slice(0, 6) as l}
                <span class="label">{l.name}</span>
              {/each}
            </div>
          {/if}
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
                  disabled={!commentText.trim() || commentSubmitting}>{commentSubmitting ? "Posting…" : "Comment"}</button
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
  .view-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 10px 8px;
    border-bottom: 1px solid var(--border);
    flex: 0 0 auto;
  }
  .result-count {
    color: var(--text-dim);
    font-size: 11px;
  }
  .short-groups {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .status-group {
    border-bottom: 1px solid var(--border);
  }
  .group-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 34px;
    padding: 7px 12px;
    border: none;
    border-radius: 0;
    background: var(--bg-elev);
    color: var(--status-solid);
    text-align: left;
    font-size: 12px;
    font-weight: 500;
  }
  .group-heading:hover { background: var(--bg-hover); }
  .group-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-solid);
    flex: 0 0 auto;
  }
  .group-name { white-space: nowrap; }
  .group-count, .group-project {
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 400;
  }
  .group-project {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .group-chevron {
    margin-left: auto;
    color: var(--text-dim);
  }
  .short-items { list-style: none; margin: 0; padding: 0; }
  .short-issue {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 4px 10px;
    min-height: 38px;
    border-left: 2px solid var(--status-solid);
    border-bottom: 1px solid var(--border);
  }
  .short-issue:last-child { border-bottom: 0; }
  .short-issue:hover { background: var(--bg-elev); }
  .short-title {
    all: unset;
    cursor: pointer;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    line-height: 1.4;
    padding: 4px 0;
  }
  .short-title:hover { color: var(--accent); }
  .short-number {
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .short-status { flex: 0 0 auto; }
  .short-status :global(.tag-label) { display: none; }
  .short-status :global(.tag) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    min-height: 26px;
    border: 1px solid color-mix(in srgb, var(--status-solid) 35%, var(--border));
    background: color-mix(in srgb, var(--status-solid) 8%, var(--bg));
    border-radius: 5px;
  }
  .short-status :global(.caret) { font-size: 13px; }
  .short-detail {
    border: none;
    background: transparent;
    padding: 0;
    width: 24px;
    min-height: 26px;
    flex: 0 0 auto;
    color: var(--text-dim);
    font-size: 20px;
    line-height: 1;
  }
  .short-title:focus-visible, .short-detail:focus-visible, .group-heading:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    .short-title, .short-detail, .group-heading { min-height: 44px; }
    .short-status :global(.tag) { min-width: 44px; min-height: 44px; }
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
  .cta {
    padding: 28px 24px;
    gap: 8px;
  }
  .cta-icon {
    font-size: 32px;
    line-height: 1;
    margin-bottom: 2px;
  }
  .cta-title {
    color: var(--text);
    font-weight: 600;
    font-size: 15px;
  }
  .cta-body {
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.5;
    max-width: 320px;
  }
  .cta-btn {
    margin-top: 10px;
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 500;
  }
  .cta-hint {
    font-size: 11px;
    margin-top: 6px;
    max-width: 300px;
    line-height: 1.5;
  }
  .linklike {
    all: unset;
    cursor: pointer;
    color: var(--accent);
  }
  .linklike:hover {
    text-decoration: underline;
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
  /* ---- G×F·4 row ---- */
  .issue {
    position: relative;
    border-bottom: 1px solid var(--border);
    transition: background 0.12s;
  }
  /* Persistent thin status-color stripe down the left edge. */
  .issue::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--status-solid);
  }
  .issue:hover {
    background: var(--bg-elev);
  }
  /* ---- awaiting-my-response cue: amber gutter dot + faint left wash ---- */
  .issue.awaiting {
    background-image: linear-gradient(
      90deg,
      rgba(227, 160, 8, 0.1) 0%,
      rgba(227, 160, 8, 0.045) 30%,
      rgba(227, 160, 8, 0) 62%
    );
  }
  .issue.awaiting:hover {
    background-color: var(--bg-elev);
    background-image: linear-gradient(
      90deg,
      rgba(227, 160, 8, 0.14) 0%,
      rgba(227, 160, 8, 0.06) 30%,
      rgba(227, 160, 8, 0) 62%
    );
  }
  .awaiting-dot {
    position: absolute;
    left: 6px;
    top: 12px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #e3a008;
    box-shadow: 0 0 0 3px rgba(227, 160, 8, 0.18);
    animation: awaiting-pulse 2.3s ease-in-out infinite;
  }
  @keyframes awaiting-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 3px rgba(227, 160, 8, 0.18);
    }
    50% {
      box-shadow: 0 0 0 5px rgba(227, 160, 8, 0.04);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .awaiting-dot {
      animation: none;
    }
  }
  /* :global reaches the label inside the AwaitingBadge child component so
     Compact shows the icon+shape only. */
  .issues[data-density="compact"] :global(.await-badge .lbl) {
    display: none;
  }
  .issues[data-density="compact"] .awaiting-dot {
    top: 9px;
  }
  .issues[data-density="spacious"] .awaiting-dot {
    top: 18px;
    width: 9px;
    height: 9px;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .row1 {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title {
    all: unset;
    cursor: pointer;
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text);
    font-weight: 500;
    line-height: 1.35;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title:hover {
    color: var(--accent);
  }
  .row1-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
  }
  .row2 {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    flex-wrap: nowrap;
    overflow: hidden;
  }
  .row3 {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #aab1bd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sep {
    opacity: 0.45;
    flex: 0 0 auto;
  }
  .repo-num {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .repo {
    opacity: 0.85;
  }
  .num {
    margin-left: 4px;
  }
  .time {
    flex: 0 0 auto;
  }
  .label {
    flex: 0 0 auto;
    color: #aab1bd;
  }
  .milestone {
    all: unset;
    cursor: pointer;
    flex: 0 0 auto;
    color: #8b949e;
  }
  .milestone:hover {
    text-decoration: underline;
  }

  /* ---- density presets (data-density on the <ul>) ---- */
  /* Default (D4): 3 rows, none wrap. */
  .issues[data-density="default"] .issue {
    padding: 9px 14px 9px 15px;
  }
  .issues[data-density="default"] .title {
    font-size: 13.5px;
  }
  .issues[data-density="default"] .row2 {
    font-size: 11px;
    margin-top: 4px;
  }
  .issues[data-density="default"] .row3 {
    font-size: 11px;
    margin-top: 3px;
  }

  /* Comfortable (D6): bigger type + padding, same 3-row structure. */
  .issues[data-density="comfortable"] .issue {
    padding: 11px 15px 11px 16px;
  }
  .issues[data-density="comfortable"] .title {
    font-size: 14px;
  }
  .issues[data-density="comfortable"] .row2 {
    font-size: 11.5px;
    margin-top: 5px;
  }
  .issues[data-density="comfortable"] .row3 {
    font-size: 11.5px;
    margin-top: 4px;
  }

  /* Spacious: large fonts + generous spacing, same 3-row structure. */
  .issues[data-density="spacious"] .issue {
    padding: 15px 18px 15px 19px;
  }
  .issues[data-density="spacious"] .title {
    font-size: 15.5px;
    line-height: 1.4;
  }
  .issues[data-density="spacious"] .row2 {
    font-size: 12.5px;
    margin-top: 7px;
  }
  .issues[data-density="spacious"] .row3 {
    font-size: 12.5px;
    margin-top: 6px;
  }

  /* Compact (D2): 2 rows — labels fold up onto row2 inline and truncate. */
  .issues[data-density="compact"] .issue {
    padding: 6px 12px 6px 14px;
  }
  .issues[data-density="compact"] .title {
    font-size: 12.5px;
  }
  .issues[data-density="compact"] .row2 {
    font-size: 10.5px;
    margin-top: 2px;
  }
  .issues[data-density="compact"] .row3 {
    display: none;
  }
  /* `.compact-only` (inline labels on row2) shows ONLY in compact mode. */
  .compact-only {
    display: none;
  }
  .issues[data-density="compact"] .compact-only {
    display: inline;
  }
  .issues[data-density="compact"] .row2-labels {
    color: #aab1bd;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
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
  .issue:focus-within .tray { opacity: 1; }
  .title:focus-visible, .tray-btn:focus-visible, .milestone:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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
