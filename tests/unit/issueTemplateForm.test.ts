import { describe, it, expect } from "vitest";
import {
  fieldKey,
  initialFormValues,
  validateForm,
  serializeForm,
  resolveAssignees,
  isFormTemplate,
  isMarkdownTemplate,
} from "../../src/lib/issueTemplateForm";
import type { FormField } from "../../src/lib/api";

const input = (over: Partial<Extract<FormField, { type: "input" }>> = {}): FormField => ({
  type: "input",
  id: over.id ?? "summary",
  label: over.label ?? "Summary",
  description: null,
  placeholder: null,
  default_value: over.default_value ?? null,
  required: over.required ?? false,
});

const dropdown = (
  over: Partial<Extract<FormField, { type: "dropdown" }>> = {},
): FormField => ({
  type: "dropdown",
  id: over.id ?? "sev",
  label: over.label ?? "Severity",
  description: null,
  options: over.options ?? ["Low", "High"],
  default_index: over.default_index ?? null,
  multiple: over.multiple ?? false,
  required: over.required ?? false,
});

const checkboxes = (
  over: Partial<Extract<FormField, { type: "checkboxes" }>> = {},
): FormField => ({
  type: "checkboxes",
  id: over.id ?? "ack",
  label: over.label ?? "Acknowledgements",
  description: null,
  options: over.options ?? [
    { label: "I searched existing issues", required: true },
    { label: "I can repro", required: false },
  ],
});

describe("fieldKey", () => {
  it("uses the field id when present", () => {
    expect(fieldKey(input({ id: "abc" }), 3)).toBe("abc");
  });
  it("falls back to a positional key when id is null", () => {
    const f = input({ id: null as unknown as string });
    expect(fieldKey({ ...f, id: null }, 2)).toBe("__f2");
  });
  it("markdown fields (no id) get positional keys", () => {
    const md: FormField = { type: "markdown", value: "hi" };
    expect(fieldKey(md, 5)).toBe("__f5");
  });
});

describe("initialFormValues", () => {
  it("seeds input/textarea defaults", () => {
    const v = initialFormValues([input({ id: "s", default_value: "hello" })]);
    expect(v.s).toBe("hello");
  });
  it("single-select dropdown honors default_index", () => {
    const v = initialFormValues([
      dropdown({ id: "d", options: ["A", "B", "C"], default_index: 2 }),
    ]);
    expect(v.d).toBe("C");
  });
  it("out-of-range default_index falls back to empty", () => {
    const v = initialFormValues([
      dropdown({ id: "d", options: ["A"], default_index: 9 }),
    ]);
    expect(v.d).toBe("");
  });
  it("multiple dropdown starts empty array", () => {
    const v = initialFormValues([dropdown({ id: "d", multiple: true })]);
    expect(v.d).toEqual([]);
  });
  it("checkboxes start all-false with correct arity", () => {
    const v = initialFormValues([checkboxes({ id: "c" })]);
    expect(v.c).toEqual([false, false]);
  });
});

describe("validateForm", () => {
  it("flags a required-but-empty input", () => {
    const fields = [input({ id: "s", required: true })];
    expect(validateForm(fields, { s: "   " })).toEqual(["Summary is required"]);
  });
  it("passes a filled required input", () => {
    const fields = [input({ id: "s", required: true })];
    expect(validateForm(fields, { s: "done" })).toEqual([]);
  });
  it("required single-select dropdown must be chosen", () => {
    const fields = [dropdown({ id: "d", required: true })];
    expect(validateForm(fields, { d: "" })).toEqual(["Severity is required"]);
  });
  it("required multiple dropdown needs at least one", () => {
    const fields = [dropdown({ id: "d", required: true, multiple: true })];
    expect(validateForm(fields, { d: [] })).toEqual(["Severity is required"]);
    expect(validateForm(fields, { d: ["Low"] })).toEqual([]);
  });
  it("required checkbox must be checked", () => {
    const fields = [checkboxes({ id: "c" })];
    // First option required, unchecked → error; second optional.
    expect(validateForm(fields, { c: [false, false] })).toEqual([
      '"I searched existing issues" must be checked',
    ]);
    expect(validateForm(fields, { c: [true, false] })).toEqual([]);
  });
});

describe("serializeForm", () => {
  it("renders headings and No response for empty optional inputs", () => {
    const fields = [input({ id: "s", label: "Summary" })];
    expect(serializeForm(fields, { s: "" })).toBe("### Summary\n\n_No response_");
  });
  it("wraps a render-typed textarea in a fenced block", () => {
    const ta: FormField = {
      type: "textarea",
      id: "logs",
      label: "Logs",
      description: null,
      placeholder: null,
      default_value: null,
      render: "shell",
      required: false,
    };
    expect(serializeForm([ta], { logs: "npm run dev" })).toBe(
      "### Logs\n\n```shell\nnpm run dev\n```",
    );
  });
  it("checkboxes serialize to GitHub task-list syntax", () => {
    const fields = [checkboxes({ id: "c" })];
    const out = serializeForm(fields, { c: [true, false] });
    expect(out).toContain("- [X] I searched existing issues");
    expect(out).toContain("- [ ] I can repro");
  });
  it("multiple dropdown joins selections with commas", () => {
    const fields = [dropdown({ id: "d", multiple: true })];
    expect(serializeForm(fields, { d: ["Low", "High"] })).toBe(
      "### Severity\n\nLow, High",
    );
  });
  it("markdown fields are not echoed into the body", () => {
    const md: FormField = { type: "markdown", value: "intro text" };
    expect(serializeForm([md], {})).toBe("");
  });
});

describe("resolveAssignees", () => {
  it("replaces @me with the login", () => {
    expect(resolveAssignees(["@me", "alice"], "octocat")).toEqual([
      "octocat",
      "alice",
    ]);
  });
  it("drops @me when login is unknown", () => {
    expect(resolveAssignees(["@me", "alice"], null)).toEqual(["alice"]);
  });
});

describe("template type guards", () => {
  it("narrows form vs markdown", () => {
    const form = { kind: "form" } as never;
    const md = { kind: "markdown" } as never;
    expect(isFormTemplate(form)).toBe(true);
    expect(isFormTemplate(md)).toBe(false);
    expect(isMarkdownTemplate(md)).toBe(true);
    expect(isFormTemplate(null)).toBe(false);
    expect(isMarkdownTemplate(null)).toBe(false);
  });
});
