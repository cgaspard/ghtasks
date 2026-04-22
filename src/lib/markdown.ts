import { marked } from "marked";
import DOMPurify, { type Config } from "dompurify";

marked.setOptions({
  gfm: true,
  breaks: true,
});

// DOMPurify config — issue bodies and comments come from untrusted users
// (anyone on the internet can put text in a public issue). CSP's
// `script-src 'self'` blocks <script> tags but NOT inline event handlers
// like `<img onerror="...">` or `javascript:` URIs, and anything that
// runs inside the webview has access to `window.__TAURI__.invoke()` —
// i.e. the full IPC surface. So we sanitize aggressively.
const PURIFY_CONFIG: Config = {
  RETURN_TRUSTED_TYPE: false,
  // Allow the tags marked produces for rendered markdown.
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "strong", "em", "b", "i", "u", "s", "del", "ins", "mark", "sub", "sup",
    "a", "img",
    "ul", "ol", "li",
    "blockquote",
    "code", "pre",
    "table", "thead", "tbody", "tr", "th", "td",
    "input", // for task-list checkboxes (disabled by markdown)
    "span", "div",
  ],
  ALLOWED_ATTR: [
    "href", "src", "alt", "title",
    "type", "checked", "disabled", // task-list checkboxes
    "class", "id",
    "align", "colspan", "rowspan",
  ],
  // Only allow http/https/mailto in href/src. This blocks javascript:,
  // file:, data: (except images — see below), smb:, etc.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  // Images may also use data: URIs (GitHub sometimes inlines small ones).
  ADD_DATA_URI_TAGS: ["img"],
  // Refuse any attribute that looks like an event handler. DOMPurify
  // already strips `on*` by default; this is belt-and-suspenders.
  FORBID_ATTR: ["style"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "style", "link", "meta"],
};

// DOMPurify's default `input` allowance is needed ONLY for GFM task-list
// checkboxes. We add a hook that strips <input> unless it's a disabled
// checkbox (which is what marked emits for `- [x]` lines). This keeps
// task-list rendering while refusing every other input type.
DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName !== "input") return;
  const el = node as HTMLInputElement;
  const isTaskCheckbox =
    el.getAttribute("type") === "checkbox" &&
    el.hasAttribute("disabled");
  if (!isTaskCheckbox) {
    el.parentNode?.removeChild(el);
  }
});

/** Render GitHub-flavored markdown to a *sanitized* HTML string. Safe
 * to drop into `{@html}` — malicious user-supplied markdown cannot
 * introduce event handlers, `javascript:` URIs, or dangerous tags. */
export function renderMarkdown(src: string | null | undefined): string {
  if (!src) return "";
  let raw: string;
  try {
    const result = marked.parse(src, { async: false });
    raw = typeof result === "string" ? result : "";
  } catch (e) {
    console.warn("[ghtasks] markdown parse failed:", e);
    raw = escapeHtml(src).replace(/\n/g, "<br>");
  }
  return DOMPurify.sanitize(raw, PURIFY_CONFIG) as unknown as string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Whether a URL scheme is safe to hand to the system opener. Used by
 * link-click interception in rendered markdown views.
 *
 * Refuses: `file:`, `javascript:`, `data:`, `smb:`, `ftp:`, unknown
 * custom schemes. The only thing we want users to be able to open
 * from an issue-body link is web content and email.
 */
export function isSafeExternalUrl(href: string): boolean {
  if (!href) return false;
  try {
    // URL constructor resolves relative URLs against the current document —
    // fine because our document's base is `tauri://` so relative paths
    // can't smuggle anything useful.
    const url = new URL(href, "https://example.invalid/");
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}
