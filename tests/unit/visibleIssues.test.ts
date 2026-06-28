import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import {
  visibleIssues,
  sourceResults,
  selectedSourceIds,
} from "../../src/lib/stores";
import type { Issue } from "../../src/lib/api";

function issue(node_id: string, number: number, updated_at: string): Issue {
  return {
    id: number,
    node_id,
    number,
    title: `Issue ${number}`,
    html_url: `https://example.com/${number}`,
    state: "open",
    labels: [],
    user: null,
    assignees: [],
    repository_url: "https://api.github.com/repos/o/r",
    body: null,
    comments: 0,
    updated_at,
    created_at: updated_at,
    pull_request: null,
  };
}

describe("visibleIssues derived store", () => {
  beforeEach(() => {
    selectedSourceIds.set(new Set());
    sourceResults.set([]);
  });

  it("sorts most-recently-updated first", () => {
    sourceResults.set([
      {
        source_id: "s1",
        issues: [
          issue("a", 1, "2026-01-01T00:00:00Z"),
          issue("b", 2, "2026-06-01T00:00:00Z"),
          issue("c", 3, "2026-03-01T00:00:00Z"),
        ],
        error: null,
      },
    ]);
    const order = get(visibleIssues).map((v) => v.issue.node_id);
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("breaks equal-timestamp ties deterministically by node_id", () => {
    const ts = "2026-06-01T00:00:00Z";
    // Insert in non-sorted node_id order; the tiebreaker must produce a stable
    // node_id-ascending order regardless of insertion order.
    sourceResults.set([
      {
        source_id: "s1",
        issues: [issue("zeta", 1, ts), issue("alpha", 2, ts), issue("mike", 3, ts)],
        error: null,
      },
    ]);
    const order = get(visibleIssues).map((v) => v.issue.node_id);
    expect(order).toEqual(["alpha", "mike", "zeta"]);
  });

  it("dedupes the same issue across sources by node_id", () => {
    sourceResults.set([
      { source_id: "s1", issues: [issue("dup", 1, "2026-01-01T00:00:00Z")], error: null },
      { source_id: "s2", issues: [issue("dup", 1, "2026-01-01T00:00:00Z")], error: null },
    ]);
    expect(get(visibleIssues)).toHaveLength(1);
  });

  it("scopes to selected sources when a selection is set", () => {
    sourceResults.set([
      { source_id: "s1", issues: [issue("a", 1, "2026-01-01T00:00:00Z")], error: null },
      { source_id: "s2", issues: [issue("b", 2, "2026-01-01T00:00:00Z")], error: null },
    ]);
    selectedSourceIds.set(new Set(["s2"]));
    const ids = get(visibleIssues).map((v) => v.issue.node_id);
    expect(ids).toEqual(["b"]);
  });
});
