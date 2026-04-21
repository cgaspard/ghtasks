import { writable, derived } from "svelte/store";
import type {
  AuthStatus,
  Issue,
  ProjectFetchResult,
  Source,
  SourceResult,
} from "./api";
import {
  persistent,
  stringSetCodec,
  nullableStringSetCodec,
} from "./persistentStore";

export const auth = writable<AuthStatus>({
  authenticated: false,
  user: null,
});

export const sources = writable<Source[]>([]);

export const sourceResults = writable<SourceResult[]>([]);

export const projectResults = writable<ProjectFetchResult[]>([]);

/** Source chips selected on the Issues tab. Persisted. */
export const selectedSourceIds = persistent<Set<string>>(
  "selectedSourceIds",
  new Set(),
  stringSetCodec,
);

/** Source chips selected on the Projects tab. Persisted. */
export const selectedProjectSourceIds = persistent<Set<string>>(
  "selectedProjectSourceIds",
  new Set(),
  stringSetCodec,
);

/** Status filter for Projects tab. `null` = "No Status". Empty set = all. Persisted. */
export const selectedStatusFilters = persistent<Set<string | null>>(
  "selectedStatusFilters",
  new Set(),
  nullableStringSetCodec,
);

/** Custom single-select field filter. Persisted. */
export const customFieldFilter = persistent<{
  fieldId: string | null;
  selected: Set<string>;
}>(
  "customFieldFilter",
  { fieldId: null, selected: new Set() },
  {
    serialize: (v) =>
      JSON.stringify({ fieldId: v.fieldId, selected: [...v.selected] }),
    deserialize: (raw) => {
      try {
        const parsed = JSON.parse(raw);
        return {
          fieldId: typeof parsed.fieldId === "string" ? parsed.fieldId : null,
          selected: Array.isArray(parsed.selected)
            ? new Set(parsed.selected)
            : new Set(),
        };
      } catch {
        return { fieldId: null, selected: new Set() };
      }
    },
  },
);

/** "Mine only" toggle on Projects tab. Persisted. Default: on. */
export const projectsOnlyMine = persistent<boolean>(
  "projectsOnlyMine",
  true,
);

/** "Mine only" toggle on Issues tab. Persisted. Default: on. */
export const issuesOnlyMine = persistent<boolean>("issuesOnlyMine", true);

export const loading = writable(false);

/** Timestamp (ms) of the last successful sync, or null before first sync. */
export const lastSyncAt = writable<number | null>(null);

/** Number of new items detected in the most recent sync (vs. prior snapshot). */
export const newSinceLastSync = writable<number>(0);

export const lastError = writable<string | null>(null);

/** Last viewed tab. Persisted. */
export const activeTab = persistent<"projects" | "issues" | "settings">(
  "activeTab",
  "projects",
);

/** When true, the New Issue modal is open. */
export const showNewIssue = writable(false);

/** Which Settings accordion section is expanded (one at a time). Persisted. */
export const settingsSection = persistent<"general" | "sources" | "about">(
  "settingsSection",
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
