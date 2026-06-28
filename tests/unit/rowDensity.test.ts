import { describe, it, expect } from "vitest";
import { resolveRowDensity } from "../../src/lib/api";

describe("resolveRowDensity", () => {
  it("passes through valid presets", () => {
    expect(resolveRowDensity("compact")).toBe("compact");
    expect(resolveRowDensity("default")).toBe("default");
    expect(resolveRowDensity("comfortable")).toBe("comfortable");
  });

  it("falls back to 'default' for empty/null/undefined", () => {
    // Settings::default() in Rust yields "" when the store is empty — this is
    // the case that must not break layout.
    expect(resolveRowDensity("")).toBe("default");
    expect(resolveRowDensity(null)).toBe("default");
    expect(resolveRowDensity(undefined)).toBe("default");
  });

  it("falls back to 'default' for unknown/legacy values", () => {
    expect(resolveRowDensity("cozy")).toBe("default");
    expect(resolveRowDensity("COMPACT")).toBe("default"); // case-sensitive by design
    expect(resolveRowDensity("relaxed")).toBe("default");
  });
});
