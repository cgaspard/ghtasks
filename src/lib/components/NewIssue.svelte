<script lang="ts">
  import { untrack } from "svelte";
  import {
    api,
    type Issue,
    type IssueTemplate,
    type IssueTemplateSet,
    type Repo,
    type RepoLabel,
    type Source,
  } from "../api";
  import {
    auth,
    lastError,
    projectResults,
    recordRecentlyCreated,
    showNewIssue,
    sourceResults,
    sources,
  } from "../stores";
  import {
    initialFormValues,
    resolveAssignees,
    serializeForm,
    validateForm,
    type FormValues,
  } from "../issueTemplateForm";
  import FilterPicker from "./FilterPicker.svelte";
  import StatusPicker from "./StatusPicker.svelte";
  import Select from "./Select.svelte";
  import IssueTemplateForm from "./IssueTemplateForm.svelte";

  interface Props {
    onCreated: () => Promise<void> | void;
  }
  let { onCreated }: Props = $props();

  type Target = "project" | "repo";

  let target: Target = $state("project");
  let repo = $state("");
  let projectSourceId = $state("");
  let title = $state("");
  let body = $state("");
  let selectedLabels = $state<Set<string>>(new Set());
  let issueType = $state("Task");
  let assignToMe = $state(true);
  let statusOptionId = $state<string>("");
  let submitting = $state(false);

  const myLogin = $derived($auth.user?.login ?? "");

  /** Snapshot for the currently-selected project, if we already fetched it. */
  const selectedProjectSnapshot = $derived(
    $projectResults.find((r) => r.source_id === projectSourceId)?.snapshot ??
      null,
  );

  /** The project's Status field (single-select named "Status"). */
  const statusField = $derived(
    selectedProjectSnapshot?.fields.find(
      (f) =>
        f.data_type === "SINGLE_SELECT" &&
        f.name.toLowerCase() === "status",
    ) ?? null,
  );

  let repos: Repo[] = $state([]);
  let loadingRepos = $state(false);

  /** Labels available in the currently selected repo. */
  let repoLabels: RepoLabel[] = $state([]);
  let loadingLabels = $state(false);
  let lastLabelsRepo = $state("");

  /** Issue templates for the currently selected repo. Fetched per-repo
   * and cached for this modal instance so switching repos doesn't
   * re-hit the Contents API unnecessarily. */
  let templates: IssueTemplate[] = $state([]);
  let blankEnabled = $state(true);
  let loadingTemplates = $state(false);
  let lastTemplatesRepo = $state("");
  const templatesByRepo = new Map<string, IssueTemplateSet>();

  /** Selected template's filename, or "" for the blank default. */
  let templateKey = $state("");
  let formValues: FormValues = $state({});
  /** Track whether the user has hand-edited body/title so we don't
   * clobber their in-progress input when switching templates. */
  let titleTouched = $state(false);
  let bodyTouched = $state(false);

  const activeTemplate = $derived<IssueTemplate | null>(
    templates.find((t) => t.filename === templateKey) ?? null,
  );

  const projectSources = $derived(
    $sources.filter((s) => s.kind === "project" && s.enabled),
  );

  async function loadRepos() {
    if (repos.length > 0 || loadingRepos) return;
    loadingRepos = true;
    try {
      repos = await api.listRepos();
      const defaults = await api.getSettings();
      if (!repo && defaults.default_repo) repo = defaults.default_repo;
    } catch (e) {
      $lastError = String(e);
    } finally {
      loadingRepos = false;
    }
  }

  $effect(() => {
    void loadRepos();
  });

  $effect(() => {
    // Default project when opening in project mode.
    if (target === "project" && !projectSourceId && projectSources.length > 0) {
      projectSourceId = projectSources[0].id;
    }
  });

  $effect(() => {
    // When project (and therefore its Status field) changes, pre-select the
    // first option so new issues land under an active column by default.
    if (!statusField) {
      statusOptionId = "";
      return;
    }
    const stillValid = statusField.options.some((o) => o.id === statusOptionId);
    if (!stillValid) {
      statusOptionId = statusField.options[0]?.id ?? "";
    }
  });

  $effect(() => {
    // When the selected repo changes, fetch its labels. Reset prior selections
    // since a label name in repo A may not exist in repo B.
    if (!repo || repo === lastLabelsRepo) return;
    const target = repo;
    lastLabelsRepo = target;
    loadingLabels = true;
    repoLabels = [];
    selectedLabels = new Set();
    api
      .listRepoLabels(target)
      .then((ls) => {
        if (lastLabelsRepo === target) repoLabels = ls;
      })
      .catch((e) => {
        $lastError = String(e);
      })
      .finally(() => {
        if (lastLabelsRepo === target) loadingLabels = false;
      });
  });

  $effect(() => {
    // When the selected repo changes, fetch its issue templates. Served
    // from a local cache on subsequent picks of the same repo.
    if (!repo || repo === lastTemplatesRepo) return;
    const target = repo;
    lastTemplatesRepo = target;
    templateKey = "";
    formValues = {};

    const cached = templatesByRepo.get(target);
    if (cached) {
      templates = cached.templates;
      blankEnabled = cached.blank_issues_enabled;
      return;
    }
    loadingTemplates = true;
    templates = [];
    api
      .listIssueTemplates(target)
      .then((set) => {
        if (lastTemplatesRepo !== target) return;
        templatesByRepo.set(target, set);
        templates = set.templates;
        blankEnabled = set.blank_issues_enabled;
      })
      .catch((e) => {
        // Non-fatal — templates are a nice-to-have. Log to console so
        // devtools users can still diagnose, but don't surface to the
        // user as an error banner.
        console.warn("[ghtasks] listIssueTemplates failed:", e);
      })
      .finally(() => {
        if (lastTemplatesRepo === target) loadingTemplates = false;
      });
  });

  /** Apply a newly-selected template: prefill title / body / labels,
   * resetting the touched-flags so re-picking another template can
   * overwrite cleanly. Never clobbers a user's in-progress typing. */
  function applyTemplate(t: IssueTemplate | null) {
    if (!t) {
      formValues = {};
      return;
    }
    if (!titleTouched) {
      if (t.title) title = t.title;
    }
    if (t.labels.length > 0) {
      // Merge additively — if they already picked labels, keep them.
      selectedLabels = new Set([...selectedLabels, ...t.labels]);
    }
    const resolved = resolveAssignees(t.assignees, myLogin || null);
    if (resolved.length > 0) {
      // The template is explicit about assignees — honor it. If @me is
      // listed, assignToMe stays on; otherwise turn it off so we don't
      // double-assign.
      assignToMe = resolved.includes(myLogin);
    }
    if (t.kind === "markdown") {
      if (!bodyTouched) body = t.body;
      formValues = {};
    } else {
      // For forms we stash the textarea content (in case the user types
      // free-form into it) and replace the body with the rendered form.
      formValues = initialFormValues(t.body);
      if (!bodyTouched) body = "";
    }
  }

  $effect(() => {
    // React to template-picker changes only. Reading other state (like
    // `titleTouched`) inside `applyTemplate` would otherwise make the
    // effect re-fire on every keystroke in the title input — causing a
    // feedback loop through the labels Set and a frozen UI.
    const t = activeTemplate;
    untrack(() => applyTemplate(t));
  });

  function close() {
    $showNewIssue = false;
    reset();
  }
  function reset() {
    title = "";
    body = "";
    selectedLabels = new Set();
    issueType = "Task";
    assignToMe = true;
    templateKey = "";
    formValues = {};
    titleTouched = false;
    bodyTouched = false;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    if (!repo) {
      $lastError = "Pick a repository.";
      return;
    }

    // If the active template is a form, validate required fields and
    // serialize the values into a markdown body matching GitHub's shape.
    let composedBody = body.trim();
    if (activeTemplate && activeTemplate.kind === "form") {
      const errs = validateForm(activeTemplate.body, formValues);
      if (errs.length > 0) {
        $lastError = errs.join(" · ");
        return;
      }
      composedBody = serializeForm(activeTemplate.body, formValues);
    }

    const input = {
      title: title.trim(),
      body: composedBody || undefined,
      labels: selectedLabels.size > 0 ? [...selectedLabels] : undefined,
      type: issueType || undefined,
      assignees: assignToMe && myLogin ? [myLogin] : undefined,
    };
    submitting = true;
    try {
      let created: Issue;
      let projectSrc:
        | (Source & { kind: "project" })
        | undefined;

      if (target === "project") {
        projectSrc = projectSources.find((s) => s.id === projectSourceId) as
          | (Source & { kind: "project" })
          | undefined;
        if (!projectSrc) {
          $lastError = "Pick a project.";
          submitting = false;
          return;
        }
        const res = await api.createIssueInProject(
          repo,
          projectSrc.project_id,
          input,
          statusField?.id,
          statusOptionId || undefined,
        );
        created = res.issue;
        const projectItem = buildProjectItem(
          created,
          repo,
          res.item_id,
          statusField?.id,
          statusOptionId || undefined,
        );
        insertProjectItem(projectSrc.id, projectItem);
        recordRecentlyCreated({
          issue: created,
          repo,
          projectSourceId: projectSrc.id,
          item: projectItem,
          createdAt: Date.now(),
        });
      } else {
        created = await api.createIssue(repo, input);
        insertOptimistically(created, undefined, repo);
        recordRecentlyCreated({
          issue: created,
          repo,
          createdAt: Date.now(),
        });
      }

      reset();
      $showNewIssue = false;
      // Don't await — let the slow snapshot fetch run in the background.
      void onCreated();
    } catch (e) {
      $lastError = String(e);
    } finally {
      submitting = false;
    }
  }

  /** Push a freshly-created Issue into a matching Repo source. */
  function insertOptimistically(
    issue: Issue,
    _projectSourceIdIgnored: string | undefined,
    repoFullName: string,
  ) {
    const targetSourceId = $sources.find(
      (s) => s.kind === "repo" && s.repo === repoFullName && s.enabled,
    )?.id;
    if (!targetSourceId) return;
    $sourceResults = $sourceResults.map((r) => {
      if (r.source_id !== targetSourceId) return r;
      if (r.issues.some((i) => i.node_id === issue.node_id)) return r;
      return { ...r, issues: [issue, ...r.issues] };
    });
  }

  /** Build a ProjectItem shell for a freshly-created issue, capturing the
   * server-assigned item_id and the chosen initial status field-value. */
  function buildProjectItem(
    issue: Issue,
    repoFullName: string,
    itemId: string,
    initialStatusFieldId?: string,
    initialStatusOptionId?: string,
  ): import("../api").ProjectItem {
    const snap = $projectResults.find((r) => r.source_id === projectSourceId)
      ?.snapshot;
    const fieldValues: import("../api").ProjectItemFieldValue[] = [];
    if (snap && initialStatusFieldId && initialStatusOptionId) {
      const field = snap.fields.find((f) => f.id === initialStatusFieldId);
      const opt = field?.options.find((o) => o.id === initialStatusOptionId);
      if (field && opt) {
        fieldValues.push({
          field_id: field.id,
          field_name: field.name,
          data_type: field.data_type,
          option_id: opt.id,
          text: opt.name,
        });
      }
    }
    return {
      item_id: itemId,
      issue,
      repo: repoFullName,
      field_values: fieldValues,
    };
  }

  /** Prepend a ProjectItem into the target project snapshot. No-op if that
   * snapshot doesn't exist yet or already has this node_id. */
  function insertProjectItem(
    projectSourceId: string,
    item: import("../api").ProjectItem,
  ) {
    $projectResults = $projectResults.map((r) => {
      if (r.source_id !== projectSourceId || !r.snapshot) return r;
      if (
        r.snapshot.items.some((it) => it.issue.node_id === item.issue.node_id)
      ) {
        return r;
      }
      return {
        ...r,
        snapshot: {
          ...r.snapshot,
          items: [item, ...r.snapshot.items],
        },
      };
    });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window on:keydown={onKey} />

<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="New issue"
>
  <div class="modal">
    <header class="head">
      <div class="title">New issue</div>
      <button class="ghost" aria-label="Close" onclick={close}>✕</button>
    </header>

    <div class="target">
      <button
        class="seg"
        class:active={target === "project"}
        onclick={() => (target = "project")}
        disabled={projectSources.length === 0}
        title={projectSources.length === 0
          ? "Add a Project source first"
          : "Create in a project"}>Project</button
      >
      <button
        class="seg"
        class:active={target === "repo"}
        onclick={() => (target = "repo")}>Repo only</button
      >
    </div>

    <form class="form" onsubmit={submit}>
      {#if target === "project"}
        <label>
          Project
          <Select
            value={projectSourceId}
            placeholder="Pick a project"
            options={projectSources.map((s) => ({
              value: s.id,
              label: s.name,
              color: s.color ?? undefined,
            }))}
            onChange={(v) => (projectSourceId = (v as string) ?? "")}
          />
        </label>

        {#if statusField}
          <label>
            Status
            <StatusPicker
              value={statusOptionId || null}
              valueName={statusField.options.find(
                (o) => o.id === statusOptionId,
              )?.name ?? null}
              valueColor={statusField.options.find(
                (o) => o.id === statusOptionId,
              )?.color ?? null}
              options={statusField.options.map((o) => ({
                id: o.id,
                name: o.name,
                color: o.color,
              }))}
              onPick={(opt) => (statusOptionId = opt ?? "")}
            />
          </label>
        {:else if !selectedProjectSnapshot}
          <div class="hint muted">
            Status options will load once the project is synced.
          </div>
        {/if}
      {/if}

      <label>
        Repository
        <Select
          value={repo}
          placeholder={loadingRepos ? "Loading…" : "Pick a repository"}
          options={repos
            .filter((r) => !r.archived)
            .map((r) => ({
              value: r.full_name,
              label: r.private ? `${r.full_name} 🔒` : r.full_name,
            }))}
          onChange={(v) => (repo = (v as string) ?? "")}
        />
      </label>

      {#if templates.length > 0 || loadingTemplates}
        <label>
          Template
          <Select
            value={templateKey}
            placeholder={loadingTemplates ? "Loading…" : "Pick a template"}
            options={[
              ...(blankEnabled
                ? [{ value: "", label: "Blank (no template)" }]
                : []),
              ...templates.map((t) => ({
                value: t.filename,
                label: t.name,
                sublabel:
                  t.kind === "markdown"
                    ? (t.about ?? undefined)
                    : (t.description ?? undefined),
              })),
            ]}
            onChange={(v) => (templateKey = (v as string) ?? "")}
          />
        </label>
      {/if}

      <label>
        Title
        <!-- svelte-ignore a11y_autofocus -->
        <input
          value={title}
          oninput={(e) => {
            title = e.currentTarget.value;
            titleTouched = true;
          }}
          placeholder="What needs to be done?"
          required
          autofocus
        />
      </label>

      {#if activeTemplate && activeTemplate.kind === "form"}
        <IssueTemplateForm
          fields={activeTemplate.body}
          bind:values={formValues}
        />
      {:else}
        <label>
          Body (markdown)
          <textarea
            rows="5"
            value={body}
            oninput={(e) => {
              body = e.currentTarget.value;
              bodyTouched = true;
            }}
            placeholder="Notes, checklist…"
          ></textarea>
        </label>
      {/if}

      <div class="row">
        <label class="grow">
          Labels
          <FilterPicker
            label={loadingLabels
              ? "Loading…"
              : repoLabels.length === 0
                ? "None available"
                : "Labels"}
            emptyLabel="None"
            options={repoLabels.map((l) => ({
              value: l.name,
              label: l.name,
              color: `#${l.color}`,
            }))}
            selected={selectedLabels}
            onChange={(next) => (selectedLabels = next)}
          />
        </label>
        <label>
          Type
          <Select
            value={issueType}
            placeholder="(none)"
            minWidth={120}
            options={[
              { value: "", label: "(none)" },
              { value: "Task", label: "Task" },
              { value: "Bug", label: "Bug" },
              { value: "Feature", label: "Feature" },
            ]}
            onChange={(v) => (issueType = (v as string) ?? "")}
          />
        </label>
      </div>

      {#if myLogin}
        <label class="inline">
          <input type="checkbox" bind:checked={assignToMe} />
          Assign to me ({myLogin})
        </label>
      {/if}

      <div class="actions">
        <button type="button" class="ghost" onclick={close}>Cancel</button>
        <button
          class="primary"
          type="submit"
          disabled={submitting || !repo || !title.trim()}
        >
          {submitting ? "Creating…" : "Create issue"}
        </button>
      </div>
    </form>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    z-index: 50;
  }
  .modal {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-weight: 500;
  }
  .target {
    display: flex;
    gap: 4px;
    padding: 8px 10px 0;
  }
  .seg {
    flex: 1;
    font-size: 12px;
    padding: 4px 8px;
    background: var(--bg-elev);
    color: var(--text-dim);
    border: 1px solid var(--border);
  }
  .seg.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  .seg:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .form {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .form label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .form label.inline {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    color: var(--text);
    font-size: 12px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    margin-top: 4px;
  }
  .hint {
    font-size: 11px;
    line-height: 1.4;
  }
  .muted {
    color: var(--text-dim);
  }
</style>
