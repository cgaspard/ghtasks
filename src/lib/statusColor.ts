/**
 * GitHub Projects v2 single-select options return colors as enum strings
 * (GREEN, YELLOW, etc.). Map them to concrete CSS colors for display.
 */
const PALETTE: Record<string, { solid: string; tint: string; ink: string }> = {
  GRAY: { solid: "#9aa0ac", tint: "rgba(154, 160, 172, 0.16)", ink: "#d0d3da" },
  BLUE: { solid: "#4f8cff", tint: "rgba(79, 140, 255, 0.16)", ink: "#a7c4ff" },
  GREEN: { solid: "#2ea043", tint: "rgba(46, 160, 67, 0.16)", ink: "#8ddca1" },
  YELLOW: {
    solid: "#d4a72c",
    tint: "rgba(212, 167, 44, 0.18)",
    ink: "#f2d97a",
  },
  ORANGE: {
    solid: "#e8892b",
    tint: "rgba(232, 137, 43, 0.18)",
    ink: "#f4b781",
  },
  RED: { solid: "#e5484d", tint: "rgba(229, 72, 77, 0.18)", ink: "#ffa3a6" },
  PINK: { solid: "#d36ac2", tint: "rgba(211, 106, 194, 0.18)", ink: "#eaa8dd" },
  PURPLE: {
    solid: "#8957e5",
    tint: "rgba(137, 87, 229, 0.18)",
    ink: "#c2a6f2",
  },
};

const FALLBACK = PALETTE.GRAY;

export function statusColor(raw: string | null | undefined) {
  if (!raw) return FALLBACK;
  const key = raw.toUpperCase();
  return PALETTE[key] ?? FALLBACK;
}
