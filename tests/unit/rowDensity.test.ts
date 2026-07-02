import { describe, it, expect } from "vitest";
import { resolveRowDensity, resolveWindowSize } from "../../src/lib/api";

describe("resolveRowDensity", () => {
  it("passes through valid presets", () => {
    expect(resolveRowDensity("compact")).toBe("compact");
    expect(resolveRowDensity("default")).toBe("default");
    expect(resolveRowDensity("comfortable")).toBe("comfortable");
    expect(resolveRowDensity("spacious")).toBe("spacious");
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

describe("resolveWindowSize", () => {
  it("passes through the two supported presets", () => {
    expect(resolveWindowSize("large")).toBe("large");
    expect(resolveWindowSize("wide")).toBe("wide");
  });

  it("maps legacy/empty values to 'large' (the nearest kept option)", () => {
    // Older installs may have compact/default/tall stored.
    expect(resolveWindowSize("compact")).toBe("large");
    expect(resolveWindowSize("default")).toBe("large");
    expect(resolveWindowSize("tall")).toBe("large");
    expect(resolveWindowSize("")).toBe("large");
    expect(resolveWindowSize(null)).toBe("large");
    expect(resolveWindowSize(undefined)).toBe("large");
  });
});
