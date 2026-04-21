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

/** Cached source-results from the previous sync. Hydrated instantly on
 * launch so the user never sees a blank "Loading issues…" state. */
export const sourceResults = persistent<SourceResult[]>(
  "sourceResults",
  [],
  {
    serialize: (v) => JSON.stringify(v),
    deserialize: (raw) => {
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    },
  },
);

/** Cached project snapshots from the previous sync. Same rationale. */
export const projectResults = persistent<ProjectFetchResult[]>(
  "projectResults",
  [],
  {
    serialize: (v) => {
      // Guard against runaway cache size (e.g. 10k-item projects) by
      // silently dropping the cache above 2000 items total. Better to eat
      // a cold refresh than to blow past the localStorage quota.
      const total = v.reduce(
        (n, r) => n + (r.snapshot?.items.length ?? 0),
        0,
      );
      if (total > 2000) return "[]";
      return JSON.stringify(v);
    },
    deserialize: (raw) => {
      try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    },
  },
);

/** Timestamp of when the cache was last written, so we can display
 * "synced Xm ago" correctly even before the first fresh sync completes. */
export const lastCacheWriteAt = persistent<number | null>(
  "lastCacheWriteAt",
  null,
);

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

/** Issues created by us in the last N seconds. The Search API and our
 * project snapshot may briefly exclude them; we use this buffer to keep
 * them on screen until the server catches up.
 *
 * Keyed by issue node_id. Value holds what we need to re-inject:
 *   - `issue` (full REST shape so repo-source results can re-show it)
 *   - `repo` (full name, for repo-source matching)
 *   - `projectSourceId` (optional; for project snapshot re-inject)
 *   - `item` (optional; full ProjectItem if we created one)
 *   - `createdAt` (ms; used for TTL eviction)
 */
export type RecentlyCreatedEntry = {
  issue: Issue;
  repo: string;
  projectSourceId?: string;
  item?: import("./api").ProjectItem;
  createdAt: number;
};
export const recentlyCreated = writable<Map<string, RecentlyCreatedEntry>>(
  new Map(),
);
const RECENT_TTL_MS = 120_000;

/** Drop expired entries in place. Call before reading. */
export function pruneRecentlyCreated() {
  const now = Date.now();
  recentlyCreated.update((m) => {
    const next = new Map(m);
    for (const [k, v] of next) {
      if (now - v.createdAt > RECENT_TTL_MS) next.delete(k);
    }
    return next;
  });
}

export function recordRecentlyCreated(entry: RecentlyCreatedEntry) {
  recentlyCreated.update((m) => {
    const next = new Map(m);
    next.set(entry.issue.node_id, entry);
    return next;
  });
}

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

/** Transient (not persisted) pointer for deep-links from list CTAs. When
 * non-null, the Sources editor auto-opens the matching new-source form on
 * mount, then clears this. */
export const settingsFocus = writable<"new-project" | "new-repo" | null>(null);

/** App version from the Tauri bundle (Info.plist on macOS, version resource
 * on Windows, etc.) — the runtime-authoritative version. Set once on
 * startup; null until resolved. */
export const appVersion = writable<string | null>(null);

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
