import { describe, it, expect } from "vitest";
import { renderMarkdown, isSafeExternalUrl } from "../../src/lib/markdown";

describe("renderMarkdown — rendering", () => {
  it("renders bold and headings", () => {
    const html = renderMarkdown("# Title\n\n**bold**");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
  });
  it("returns empty string for null/empty", () => {
    expect(renderMarkdown(null)).toBe("");
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
  });
  it("keeps disabled task-list checkboxes", () => {
    const html = renderMarkdown("- [x] done\n- [ ] todo");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("disabled");
  });
});

describe("renderMarkdown — sanitization (XSS)", () => {
  it("strips <script> tags", () => {
    const html = renderMarkdown("hi <script>alert(1)</script>");
    expect(html).not.toContain("<script");
  });
  it("strips inline event handlers like onerror", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html.toLowerCase()).not.toContain("onerror");
  });
  it("drops javascript: URIs on links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });
  it("strips iframe/object/embed/form", () => {
    const html = renderMarkdown(
      '<iframe src="https://evil"></iframe><form></form>',
    );
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<form");
  });
  it("removes inline style attributes", () => {
    const html = renderMarkdown('<span style="position:fixed">x</span>');
    expect(html).not.toContain("style=");
  });
  it("strips non-task <input> elements", () => {
    const html = renderMarkdown('<input type="text" value="x">');
    // text inputs are removed; only disabled checkboxes survive
    expect(html).not.toContain('type="text"');
  });
});

describe("isSafeExternalUrl", () => {
  it("allows http/https/mailto", () => {
    expect(isSafeExternalUrl("https://github.com")).toBe(true);
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
    expect(isSafeExternalUrl("mailto:a@b.com")).toBe(true);
  });
  it("rejects dangerous and unknown schemes", () => {
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeExternalUrl("smb://share")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
  });
});
