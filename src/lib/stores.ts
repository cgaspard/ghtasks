import { writable, derived } from "svelte/store";
import type { AuthStatus, Issue, Source, SourceResult } from "./api";

export const auth = writable<AuthStatus>({
  authenticated: false,
  user: null,
});

export const sources = writable<Source[]>([]);

export const sourceResults = writable<SourceResult[]>([]);

export const selectedSourceIds = writable<Set<string>>(new Set());

export const loading = writable(false);

export const lastError = writable<string | null>(null);

export const activeTab = writable<"issues" | "sources" | "new" | "settings">(
  "issues",
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
