import { persistent } from "./persistentStore";
import type { FormValues } from "./issueTemplateForm";

export interface NewIssueDraft {
  repo: string;
  projectSourceId: string;
  title: string;
  body: string;
  selectedLabels: string[];
  issueType: string;
  assignToMe: boolean;
  statusOptionId: string | null;
  templateKey: string;
  formValues: FormValues;
  titleTouched: boolean;
  bodyTouched: boolean;
}

export const newIssueDraft = persistent<NewIssueDraft | null>("newIssueDraft", null, {
  deserialize: (raw) => {
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== "object") return null;
    const strings = ["repo", "projectSourceId", "title", "body", "issueType", "templateKey"];
    if (!strings.every((key) => typeof draft[key] === "string")) return null;
    if (!Array.isArray(draft.selectedLabels) || !draft.selectedLabels.every((label: unknown) => typeof label === "string")) return null;
    if (typeof draft.assignToMe !== "boolean" || typeof draft.titleTouched !== "boolean" || typeof draft.bodyTouched !== "boolean") return null;
    if (draft.statusOptionId !== null && typeof draft.statusOptionId !== "string") return null;
    if (!draft.formValues || typeof draft.formValues !== "object" || Array.isArray(draft.formValues)) return null;
    if (!Object.values(draft.formValues).every((value) => typeof value === "string" || (Array.isArray(value) && (value.every((item) => typeof item === "string") || value.every((item) => typeof item === "boolean"))))) return null;
    return draft as NewIssueDraft;
  },
});

export function clearNewIssueDraft() {
  newIssueDraft.set(null);
}
