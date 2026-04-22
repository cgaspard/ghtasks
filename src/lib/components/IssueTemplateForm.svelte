<script lang="ts">
  import type { FormField } from "../api";
  import Select from "./Select.svelte";

  interface Props {
    fields: FormField[];
    /** Flat map of field id (or generated key) → value. Two-way bound. */
    values: Record<string, string | string[] | boolean[]>;
  }
  let { fields, values = $bindable() }: Props = $props();

  /** Stable key for a field. Forms may omit `id`; we fall back to index. */
  function keyOf(f: FormField, idx: number): string {
    if ("id" in f && f.id) return f.id;
    return `__f${idx}`;
  }

  /** Cast helpers so we don't splatter `as` in the template. */
  function asString(v: unknown): string {
    return typeof v === "string" ? v : "";
  }
  function asStringArray(v: unknown): string[] {
    return Array.isArray(v) && v.every((x) => typeof x === "string")
      ? (v as string[])
      : [];
  }
  function asBoolArray(v: unknown, len: number): boolean[] {
    if (Array.isArray(v) && v.length === len) return v as boolean[];
    return Array(len).fill(false);
  }
</script>

<div class="form-body">
  {#each fields as field, i (keyOf(field, i))}
    {@const key = keyOf(field, i)}
    {#if field.type === "markdown"}
      <div class="md-block">{field.value}</div>
    {:else if field.type === "input"}
      <label>
        <span class="lbl">
          {field.label}{#if field.required}<span class="req">*</span>{/if}
        </span>
        {#if field.description}
          <span class="desc muted">{field.description}</span>
        {/if}
        <input
          value={asString(values[key])}
          placeholder={field.placeholder ?? ""}
          oninput={(e) =>
            (values = { ...values, [key]: e.currentTarget.value })}
        />
      </label>
    {:else if field.type === "textarea"}
      <label>
        <span class="lbl">
          {field.label}{#if field.required}<span class="req">*</span>{/if}
        </span>
        {#if field.description}
          <span class="desc muted">{field.description}</span>
        {/if}
        <textarea
          rows="4"
          value={asString(values[key])}
          placeholder={field.placeholder ?? ""}
          class:codeblock={!!field.render}
          oninput={(e) =>
            (values = { ...values, [key]: e.currentTarget.value })}
        ></textarea>
      </label>
    {:else if field.type === "dropdown"}
      <label>
        <span class="lbl">
          {field.label}{#if field.required}<span class="req">*</span>{/if}
        </span>
        {#if field.description}
          <span class="desc muted">{field.description}</span>
        {/if}
        {#if field.multiple}
          <div class="multi">
            {#each field.options as opt}
              {@const arr = asStringArray(values[key])}
              <label class="inline small">
                <input
                  type="checkbox"
                  checked={arr.includes(opt)}
                  onchange={(e) => {
                    const on = e.currentTarget.checked;
                    const next = on
                      ? [...arr, opt]
                      : arr.filter((v) => v !== opt);
                    values = { ...values, [key]: next };
                  }}
                />
                {opt}
              </label>
            {/each}
          </div>
        {:else}
          <Select
            value={asString(values[key]) || null}
            placeholder="Pick one"
            options={[
              { value: "", label: field.required ? "— pick one —" : "— none —" },
              ...field.options.map((o) => ({ value: o, label: o })),
            ]}
            onChange={(v) =>
              (values = { ...values, [key]: (v as string) ?? "" })}
          />
        {/if}
      </label>
    {:else if field.type === "checkboxes"}
      <fieldset>
        <legend class="lbl">{field.label}</legend>
        {#if field.description}
          <span class="desc muted">{field.description}</span>
        {/if}
        <div class="checks">
          {#each field.options as opt, oi}
            {@const arr = asBoolArray(values[key], field.options.length)}
            <label class="inline small">
              <input
                type="checkbox"
                checked={arr[oi]}
                onchange={(e) => {
                  const next = [...arr];
                  next[oi] = e.currentTarget.checked;
                  values = { ...values, [key]: next };
                }}
              />
              {opt.label}{#if opt.required}<span class="req">*</span>{/if}
            </label>
          {/each}
        </div>
      </fieldset>
    {/if}
  {/each}
</div>

<style>
  .form-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .lbl {
    color: var(--text);
    font-weight: 500;
  }
  .req {
    color: var(--danger);
    margin-left: 2px;
  }
  .desc {
    font-size: 11px;
    line-height: 1.4;
  }
  .md-block {
    font-size: 12px;
    color: var(--text-dim);
    line-height: 1.5;
    padding: 6px 10px;
    border-left: 2px solid var(--border);
    white-space: pre-wrap;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  legend {
    padding: 0 4px;
    font-size: 12px;
  }
  .checks,
  .multi {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .inline {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--text);
  }
  .small {
    font-size: 12px;
  }
  textarea.codeblock {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
  }
  input,
  textarea {
    background: var(--bg-elev);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 13px;
  }
  input:focus,
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }
</style>
