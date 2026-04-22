import { marked } from "marked";

// GFM + line-break-on-single-newline matches how GitHub renders issue
// bodies in the web UI. HTML passthrough is NOT disabled at the marked
// level — our CSP (`script-src 'self'`) already blocks inline scripts,
// and we rely on that as the primary defense. The render options here
// just set presentation defaults.
marked.setOptions({
  gfm: true,
  breaks: true,
});

/** Render GitHub-flavored markdown to an HTML string. Returns plain
 * text wrapped in <p> on parse failure, so a bad input never blanks the
 * UI. */
export function renderMarkdown(src: string | null | undefined): string {
  if (!src) return "";
  try {
    const result = marked.parse(src, { async: false });
    return typeof result === "string" ? result : "";
  } catch (e) {
    console.warn("[ghtasks] markdown parse failed:", e);
    return escapeHtml(src).replace(/\n/g, "<br>");
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
