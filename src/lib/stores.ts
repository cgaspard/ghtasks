import { writable, derived } from "svelte/store";
import type {
  AuthStatus,
  Issue,
  ProjectFetchResult,
  Source,
  SourceResult,
} from "./api";

export const auth = writable<AuthStatus>({
  authenticated: false,
  user: null,
});

export const sources = writable<Source[]>([]);

export const sourceResults = writable<SourceResult[]>([]);

export const projectResults = writable<ProjectFetchResult[]>([]);

export const selectedSourceIds = writable<Set<string>>(new Set());

/** Selected project-source ids on the Projects tab (separate filter state). */
export const selectedProjectSourceIds = writable<Set<string>>(new Set());

/** Status filter for Projects tab. `null` = all, "" = "No Status". */
export const selectedStatusFilters = writable<Set<string | null>>(new Set());

/** Custom single-select field filter: which field id (or null for none), and which option ids are selected. */
export const customFieldFilter = writable<{
  fieldId: string | null;
  selected: Set<string>;
}>({ fieldId: null, selected: new Set() });

export const loading = writable(false);

/** Timestamp (ms) of the last successful sync, or null before first sync. */
export const lastSyncAt = writable<number | null>(null);

/** Number of new items detected in the most recent sync (vs. prior snapshot). */
export const newSinceLastSync = writable<number>(0);

export const lastError = writable<string | null>(null);

export const activeTab = writable<"projects" | "issues" | "settings">(
  "projects",
);

/** When true, the New Issue modal is open. */
export const showNewIssue = writable(false);

/** Which Settings accordion section is expanded (one at a time). */
export const settingsSection = writable<"general" | "sources" | "about">(
  "general",
);

/** Flat list of issues across enabled, selected sources, deduped by node_id. */
export const visibleIssues = derived(
  [sourceResults, selectedSourceIds],
  ([$results, $selected]) => {
    const seen = new Set<string>();
    const out: Array<{ issue: Issue; sourceId: string }> = [];
    const scope =
      $selected.size === 0
        ? $results
        : $results.filter((r) => $selected.has(r.source_id));
    for (const r of scope) {
      for (const i of r.issues) {
        if (seen.has(i.node_id)) continue;
        seen.add(i.node_id);
        out.push({ issue: i, sourceId: r.source_id });
      }
    }
    // Most recently updated first.
    out.sort((a, b) =>
      a.issue.updated_at < b.issue.updated_at ? 1 : -1,
    );
    return out;
  },
);
