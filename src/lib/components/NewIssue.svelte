<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { get } from "svelte/store";
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
    createdIssueNotice,
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
  import { clearNewIssueDraft, newIssueDraft, type NewIssueDraft } from "../newIssueDraft";

  interface Props {
    onCreated: () => Promise<void> | void;
  }
  let { onCreated }: Props = $props();

  const initialDraft = get(newIssueDraft);
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let keepDraft = true;
  let disposed = false;
  let repo = $state(initialDraft?.repo ?? "");
  let projectSourceId = $state(initialDraft?.projectSourceId ?? "");
  let title = $state(initialDraft?.title ?? "");
  let body = $state(initialDraft?.body ?? "");
  let selectedLabels = $state<Set<string>>(new Set(initialDraft?.selectedLabels ?? []));
  let issueType = $state(initialDraft?.issueType ?? "Task");
  let assignToMe = $state(initialDraft?.assignToMe ?? true);
  let statusOptionId = $state<string | null>(initialDraft?.statusOptionId ?? null);
  let submitting = $state(false);
  let formErrors: string[] = $state([]);
  let repoError = $state("");
  let labelsError = $state("");
  let templatesError = $state("");
  let modal: HTMLDivElement;
  let titleInput: HTMLInputElement;

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
  let templateKey = $state(initialDraft?.templateKey ?? "");
  let formValues: FormValues = $state(initialDraft?.formValues ?? {});
  /** Track whether the user has hand-edited body/title so we don't
   * clobber their in-progress input when switching templates. */
  let titleTouched = $state(initialDraft?.titleTouched ?? false);
  let bodyTouched = $state(initialDraft?.bodyTouched ?? false);

  const activeTemplate = $derived<IssueTemplate | null>(
    templates.find((t) => t.filename === templateKey) ?? null,
  );

  const projectSources = $derived(
    $sources.filter((s) => s.kind === "project" && s.enabled),
  );

  const missingTemplate = $derived(!loadingTemplates && !!templateKey && !activeTemplate);
  const templateAssignees = $derived(resolveAssignees(activeTemplate?.assignees ?? [], myLogin || null).filter((login) => login !== myLogin));

  function snapshotDraft(): NewIssueDraft {
    return { repo, projectSourceId, title, body, selectedLabels: [...selectedLabels], issueType, assignToMe, statusOptionId, templateKey, formValues: $state.snapshot(formValues), titleTouched, bodyTouched };
  }

  $effect(() => {
    const draft = snapshotDraft();
    if (keepDraft) newIssueDraft.set(draft);
  });

  onMount(() => {
    void loadRepos();
    void tick().then(() => titleInput?.focus());
    return () => {
      disposed = true;
      keepDraft = false;
      requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
  });

  async function loadRepos() {
    if (loadingRepos) return;
    loadingRepos = true;
    repoError = "";
    try {
      repos = await api.listRepos();
      const defaults = await api.getSettings();
      if (!disposed && !repo && defaults.default_repo) repo = defaults.default_repo;
    } catch (e) {
      repoError = `Couldn’t load repositories: ${String(e)}`;
    } finally {
      loadingRepos = false;
    }
  }

  $effect(() => {
    // When project (and therefore its Status field) changes, pre-select the
    // first option so new issues land under an active column by default.
    if (!projectSourceId) {
      statusOptionId = null;
      return;
    }
    if (!selectedProjectSnapshot) return;
    if (!statusField) { statusOptionId = ""; return; }
    if (statusOptionId === "") return;
    const stillValid = statusField.options.some((o) => o.id === statusOptionId);
    if (!stillValid) {
      statusOptionId = statusField.options[0]?.id ?? "";
    }
  });

  $effect(() => {
    if (!repo || repo === lastLabelsRepo) return;
    const target = repo;
    untrack(() => { void loadLabels(target); });
  });

  async function loadLabels(target: string) {
    if (!target) return;
    lastLabelsRepo = target;
    loadingLabels = true;
    labelsError = "";
    repoLabels = [];
    try {
      const labels = await api.listRepoLabels(target);
      if (!disposed && lastLabelsRepo === target) repoLabels = labels;
    } catch (e) {
      if (!disposed && lastLabelsRepo === target) labelsError = `Couldn’t load labels: ${String(e)}`;
    } finally {
      if (lastLabelsRepo === target) loadingLabels = false;
    }
  }

  $effect(() => {
    if (!repo || repo === lastTemplatesRepo) return;
    const target = repo;
    untrack(() => { void loadTemplates(target); });
  });

  async function loadTemplates(target: string, force = false) {
    if (!target) return;
    lastTemplatesRepo = target;
    loadingTemplates = true;
    templatesError = "";
    templates = [];
    try {
      const set = (!force && templatesByRepo.get(target)) || await api.listIssueTemplates(target);
      if (disposed || lastTemplatesRepo !== target) return;
      templatesByRepo.set(target, set);
      templates = set.templates;
      blankEnabled = set.blank_issues_enabled;
      if (!blankEnabled && !templateKey && templates.length > 0) pickTemplate(templates[0].filename);
    } catch (e) {
      if (!disposed && lastTemplatesRepo === target) templatesError = `Couldn’t load issue templates: ${String(e)}`;
    } finally {
      if (lastTemplatesRepo === target) loadingTemplates = false;
    }
  }

  function pickRepo(next: string) {
    if (next === repo) return;
    repo = next;
    selectedLabels = new Set();
    templateKey = "";
    formValues = {};
    titleTouched = false;
    bodyTouched = false;
    formErrors = [];
  }

  function pickTemplate(next: string) {
    templateKey = next;
    formErrors = [];
    applyTemplate(templates.find((template) => template.filename === next) ?? null);
  }

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

  function close() {
    if (submitting) return;
    newIssueDraft.set(snapshotDraft());
    $showNewIssue = false;
  }

  function discard() {
    if (submitting) return;
    keepDraft = false;
    clearNewIssueDraft();
    $showNewIssue = false;
  }

  async function submit(e: Event) {
    e.preventDefault();
    if (submitting) return;
    formErrors = [];
    if (!repo) formErrors.push("Pick a repository.");
    if (!title.trim()) formErrors.push("Enter an issue title.");
    if (loadingTemplates || templatesError) formErrors.push("Load the repository’s issue templates before creating the issue.");
    if (missingTemplate) formErrors.push("Your saved template is unavailable. Choose an available template or a blank issue.");
    if (!blankEnabled && !activeTemplate) formErrors.push("Choose an issue template for this repository.");
    const projectSrc = projectSources.find((source) => source.id === projectSourceId) as (Source & { kind: "project" }) | undefined;
    if (projectSourceId && !projectSrc) formErrors.push("The saved project connection is unavailable. Choose another project or No project.");
    if (projectSourceId && !selectedProjectSnapshot) formErrors.push("Sync this project before creating the issue, or choose No project.");
    if (formErrors.length > 0) return;

    // If the active template is a form, validate required fields and
    // serialize the values into a markdown body matching GitHub's shape.
    let composedBody = body.trim();
    if (activeTemplate && activeTemplate.kind === "form") {
      const errs = validateForm(activeTemplate.body, formValues);
      if (errs.length > 0) {
        formErrors = errs;
        return;
      }
      composedBody = serializeForm(activeTemplate.body, formValues);
    }

    const input = {
      title: title.trim(),
      body: composedBody || undefined,
      labels: selectedLabels.size > 0 ? [...selectedLabels] : undefined,
      type: issueType || undefined,
      assignees: [...new Set([...templateAssignees, ...(assignToMe && myLogin ? [myLogin] : [])])],
    };
    const targetRepo = repo;
    submitting = true;
    try {
      let created: Issue;
      if (projectSrc) {
        // Capture the project + status selection BEFORE awaiting so a
        // mid-flight project switch can't make the optimistic item point at
        // the wrong board / status field.
        const srcId = projectSrc.id;
        const fieldId = statusField?.id;
        const optionId = statusOptionId || undefined;
        const res = await api.createIssueInProject(
          targetRepo,
          projectSrc.project_id,
          input,
          fieldId,
          optionId,
        );
        created = res.issue;
        const projectItem = buildProjectItem(
          created,
          targetRepo,
          res.item_id,
          srcId,
          fieldId,
          optionId,
        );
        insertProjectItem(projectSrc.id, projectItem);
        recordRecentlyCreated({
          issue: created,
          repo: targetRepo,
          projectSourceId: projectSrc.id,
          item: projectItem,
          createdAt: Date.now(),
        });
      } else {
        created = await api.createIssue(targetRepo, input);
        recordRecentlyCreated({
          issue: created,
          repo: targetRepo,
          createdAt: Date.now(),
        });
      }

      insertOptimistically(created, targetRepo);
      keepDraft = false;
      clearNewIssueDraft();
      $createdIssueNotice = { repo: targetRepo, issue: created };
      $showNewIssue = false;
      // Don't await — let the slow snapshot fetch run in the background.
      void onCreated();
    } catch (e) {
      formErrors = [`Couldn’t create the issue: ${String(e)}`];
    } finally {
      submitting = false;
    }
  }

  /** Push a freshly-created Issue into a matching Repo source. */
  function insertOptimistically(
    issue: Issue,
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
    srcId: string,
    initialStatusFieldId?: string,
    initialStatusOptionId?: string,
  ): import("../api").ProjectItem {
    const snap = $projectResults.find((r) => r.source_id === srcId)?.snapshot;
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
    if (e.defaultPrevented) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "Tab" || !modal) return;
    const controls = [...modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary')]
      .filter((element) => {
        const collapsed = element.closest("details:not([open])");
        return element.getClientRects().length > 0 && !element.closest('[hidden], [inert]')
          && (!collapsed || collapsed.querySelector(":scope > summary")?.contains(element));
      });
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window on:keydown={onKey} />

<div
  class="backdrop"
  bind:this={modal}
  role="dialog"
  aria-modal="true"
  aria-label="New issue"
  aria-describedby="new-issue-draft-hint"
>
  <div class="modal">
    <header class="head">
      <div><div class="title">New issue</div><p id="new-issue-draft-hint" class="hint muted">Closing keeps your draft.</p></div>
      <button class="ghost" aria-label="Close" onclick={close} disabled={submitting}>✕</button>
    </header>

    <form class="form" onsubmit={submit} novalidate>
      <fieldset disabled={submitting}>
      {#if repoError}
        <div class="local-error" role="alert"><span>{repoError}</span><button type="button" class="ghost" onclick={() => loadRepos()}>Retry repositories</button></div>
      {/if}

      <label>
        Repository
        <Select
          value={repo}
          ariaLabel="Repository"
          placeholder={loadingRepos ? "Loading…" : "Pick a repository"}
          options={[
            ...(repo && !repos.some((r) => r.full_name === repo) ? [{ value: repo, label: repo }] : []),
            ...repos.filter((r) => !r.archived).map((r) => ({
              value: r.full_name,
              label: r.private ? `${r.full_name} 🔒` : r.full_name,
            })),
          ]}
          onChange={(v) => pickRepo((v as string) ?? "")}
        />
      </label>

      {#if templates.length > 0 || loadingTemplates || missingTemplate}
        <label>
          Template
          <Select
            value={templateKey}
            ariaLabel="Issue template"
            disabled={loadingTemplates}
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
            onChange={(v) => pickTemplate((v as string) ?? "")}
          />
        </label>
      {/if}
      {#if templatesError}
        <div class="local-error" role="alert"><span>{templatesError}</span><button type="button" class="ghost" onclick={() => loadTemplates(repo, true)}>Retry templates</button></div>
      {:else if missingTemplate}
        <div class="local-error" role="alert">Your saved template is unavailable. Choose another template or a blank issue.</div>
      {/if}

      <label>
        Title
        <input
          bind:this={titleInput}
          value={title}
          oninput={(e) => {
            title = e.currentTarget.value;
            titleTouched = true;
          }}
          placeholder="What needs to be done?"
          required
        />
      </label>

      {#if activeTemplate && activeTemplate.kind === "form"}
        <IssueTemplateForm
          fields={activeTemplate.body}
          bind:values={formValues}
        />
      {:else}
        <label>
          Description (Markdown)
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

      <label>
        Add to project
        <Select
          value={projectSourceId}
          ariaLabel="Add to project"
          options={[
            { value: "", label: "No project" },
            ...projectSources.map((source) => ({ value: source.id, label: source.name, color: source.color ?? undefined })),
          ]}
          onChange={(value) => { projectSourceId = (value as string) ?? ""; statusOptionId = null; formErrors = []; }}
        />
      </label>
      {#if projectSourceId && statusField}
        <label>
          Initial project status
          <StatusPicker
            value={statusOptionId || null}
            valueName={statusField.options.find((option) => option.id === statusOptionId)?.name ?? null}
            valueColor={statusField.options.find((option) => option.id === statusOptionId)?.color ?? null}
            options={statusField.options.map((option) => ({ id: option.id, name: option.name, color: option.color }))}
            ariaLabel="Initial project status"
            onPick={(option) => (statusOptionId = option ?? "")}
          />
        </label>
      {:else if projectSourceId && !selectedProjectSnapshot}
        <p class="hint muted">Sync this project before creating an issue, or choose No project.</p>
      {/if}

      <details class="issue-options">
      <summary>Issue options <span class="muted">Labels, type and assignees</span></summary>
      <div class="options-body">
      {#if labelsError}
        <div class="local-error" role="alert"><span>{labelsError}</span><button type="button" class="ghost" onclick={() => loadLabels(repo)}>Retry labels</button></div>
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
      {#if templateAssignees.length > 0}<p class="hint muted">The template also assigns {templateAssignees.join(", ")}.</p>{/if}
      </div>
      </details>

      {#if formErrors.length > 0}
        <div class="local-error" role="alert"><ul>{#each formErrors as error}<li>{error}</li>{/each}</ul></div>
      {/if}

      <div class="actions">
        <button type="button" class="discard" onclick={discard}>Discard draft</button>
        <button type="button" class="ghost" onclick={close}>Keep draft &amp; go back</button>
        <button
          class="primary"
          type="submit"
          disabled={submitting || !repo || !title.trim() || loadingTemplates || !!templatesError || missingTemplate || (!!projectSourceId && !selectedProjectSnapshot)}
        >
          {submitting ? "Creating…" : "Create issue"}
        </button>
      </div>
      </fieldset>
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
    padding: 12px 18px;
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-weight: 500;
    font-size: 18px;
  }
  .head p { margin: 4px 0 0; }
  fieldset {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .form {
    padding: 18px;
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
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
  }
  .actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .actions button { font-size: 12px; }
  .discard { border: 0; background: transparent; color: var(--text-dim); margin-right: auto; padding-left: 0; }
  .discard:hover { color: var(--danger); }
  .issue-options { border: 1px solid var(--border); border-radius: 8px; background: var(--bg-elev); }
  .issue-options > summary { cursor: pointer; padding: 10px 12px; font-size: 12px; }
  .issue-options > summary span { display: block; margin: 3px 0 0 14px; font-size: 11px; }
  .options-body { display: flex; flex-direction: column; gap: 12px; padding: 12px; border-top: 1px solid var(--border); }
  .local-error { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 10px 12px; background: rgba(229, 72, 77, 0.12); border: 1px solid rgba(229, 72, 77, 0.35); border-radius: 8px; color: #ffb4b7; font-size: 12px; }
  .local-error ul { margin: 0; padding-left: 16px; }
  .hint {
    font-size: 11px;
    line-height: 1.4;
  }
  .muted {
    color: var(--text-dim);
  }
</style>
