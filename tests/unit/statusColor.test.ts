import { describe, it, expect } from "vitest";
import { statusColor } from "../../src/lib/statusColor";

describe("statusColor", () => {
  it("maps known GitHub color enums", () => {
    expect(statusColor("GREEN").solid).toBe("#2ea043");
    expect(statusColor("RED").solid).toBe("#e5484d");
  });
  it("is case-insensitive", () => {
    expect(statusColor("green")).toEqual(statusColor("GREEN"));
  });
  it("falls back to GRAY for null/undefined/unknown", () => {
    const gray = statusColor("GRAY");
    expect(statusColor(null)).toEqual(gray);
    expect(statusColor(undefined)).toEqual(gray);
    expect(statusColor("CHARTREUSE")).toEqual(gray);
  });
  it("returns the full {solid,tint,ink} shape", () => {
    const c = statusColor("BLUE");
    expect(c).toHaveProperty("solid");
    expect(c).toHaveProperty("tint");
    expect(c).toHaveProperty("ink");
  });
});
