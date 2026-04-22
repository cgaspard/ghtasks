import type { FormField, IssueTemplate } from "./api";

export type FieldValue = string | string[] | boolean[];
export type FormValues = Record<string, FieldValue>;

/** Stable key for a field — matches the convention used by IssueTemplateForm. */
export function fieldKey(f: FormField, idx: number): string {
  if ("id" in f && f.id) return f.id;
  return `__f${idx}`;
}

/** Build the initial values map for a template's fields, respecting
 * `default_value` / `default_index` on each field. */
export function initialFormValues(fields: FormField[]): FormValues {
  const out: FormValues = {};
  fields.forEach((f, i) => {
    const key = fieldKey(f, i);
    switch (f.type) {
      case "markdown":
        break;
      case "input":
      case "textarea":
        out[key] = f.default_value ?? "";
        break;
      case "dropdown":
        if (f.multiple) {
          out[key] = [];
        } else {
          const idx = f.default_index;
          out[key] =
            idx !== null && idx !== undefined && idx >= 0 && idx < f.options.length
              ? f.options[idx]
              : "";
        }
        break;
      case "checkboxes":
        out[key] = f.options.map(() => false);
        break;
    }
  });
  return out;
}

/** Returns the list of required-field problems as human-readable strings.
 * Empty array means the form is valid. */
export function validateForm(
  fields: FormField[],
  values: FormValues,
): string[] {
  const errors: string[] = [];
  fields.forEach((f, i) => {
    const key = fieldKey(f, i);
    switch (f.type) {
      case "input":
      case "textarea":
        if (f.required && !String(values[key] ?? "").trim()) {
          errors.push(`${f.label} is required`);
        }
        break;
      case "dropdown":
        if (f.required) {
          const v = values[key];
          if (f.multiple) {
            if (!Array.isArray(v) || v.length === 0) {
              errors.push(`${f.label} is required`);
            }
          } else if (!String(v ?? "").trim()) {
            errors.push(`${f.label} is required`);
          }
        }
        break;
      case "checkboxes": {
        const arr = Array.isArray(values[key])
          ? (values[key] as boolean[])
          : [];
        f.options.forEach((opt, oi) => {
          if (opt.required && !arr[oi]) {
            errors.push(`"${opt.label}" must be checked`);
          }
        });
        break;
      }
    }
  });
  return errors;
}

/** Serialize form values into the markdown body GitHub produces when
 * you submit an issue form on github.com: one `### <label>` heading per
 * field, followed by the value (or `_No response_` for empty optional
 * inputs). Textareas with `render` become fenced code blocks. */
export function serializeForm(
  fields: FormField[],
  values: FormValues,
): string {
  const out: string[] = [];
  fields.forEach((f, i) => {
    const key = fieldKey(f, i);
    switch (f.type) {
      case "markdown":
        // GitHub doesn't echo the markdown blocks back into the body.
        break;
      case "input": {
        const v = String(values[key] ?? "").trim();
        out.push(`### ${f.label}\n\n${v || "_No response_"}`);
        break;
      }
      case "textarea": {
        const v = String(values[key] ?? "").trim();
        if (!v) {
          out.push(`### ${f.label}\n\n_No response_`);
        } else if (f.render) {
          out.push(
            `### ${f.label}\n\n\`\`\`${f.render}\n${v}\n\`\`\``,
          );
        } else {
          out.push(`### ${f.label}\n\n${v}`);
        }
        break;
      }
      case "dropdown": {
        const v = values[key];
        if (f.multiple) {
          const arr = Array.isArray(v) ? (v as string[]) : [];
          out.push(
            `### ${f.label}\n\n${arr.length ? arr.join(", ") : "_No response_"}`,
          );
        } else {
          const s = String(v ?? "").trim();
          out.push(`### ${f.label}\n\n${s || "_No response_"}`);
        }
        break;
      }
      case "checkboxes": {
        const arr = Array.isArray(values[key])
          ? (values[key] as boolean[])
          : [];
        const lines = f.options.map(
          (opt, oi) => `- [${arr[oi] ? "X" : " "}] ${opt.label}`,
        );
        out.push(`### ${f.label}\n\n${lines.join("\n")}`);
        break;
      }
    }
  });
  return out.join("\n\n");
}

/** Resolve any `@me` entries in a template's assignees to the signed-in
 * user's login (or strip them if we don't know yet). */
export function resolveAssignees(
  raw: string[],
  myLogin: string | null,
): string[] {
  return raw
    .map((a) => (a === "@me" ? myLogin ?? "" : a))
    .filter((a) => a.length > 0);
}

/** Type guard so consumers can narrow without `kind === "..."` everywhere. */
export function isFormTemplate(
  t: IssueTemplate | null,
): t is Extract<IssueTemplate, { kind: "form" }> {
  return t !== null && t.kind === "form";
}
export function isMarkdownTemplate(
  t: IssueTemplate | null,
): t is Extract<IssueTemplate, { kind: "markdown" }> {
  return t !== null && t.kind === "markdown";
}
