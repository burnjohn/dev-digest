/* CodeInput — the skill (owner_kind === "skill") arm's `Input` tab set
   (REQ-53/54/60). Colocated under EvalCaseEditor's `_components/` (T14's
   established convention for this modal's sub-pieces) and rendered from the
   ONE seam T20 owns in `EvalCaseEditor.tsx` — never a second call site.

   FIX-2 (REQ-56/57/59): this component is CONTROLLED — `EvalCaseEditor` owns
   `filename`/`before`/`after`/`kind` in its own state and passes them down as
   `value` + `onChange`, so a skill-owned save has something to read
   (`helpers.ts` `buildEvalCaseWrite` / `skill-helpers.ts`
   `buildSkillInputFiles`). Before this fix the fields lived in a local
   `useState` here with no way out of the component — the write was a dead end.
   This component now holds no state at all.

   LAYOUT (2026-08-29): the editors keep their original fixed `rows`. A version
   that flexed them into the modal's leftover height was tried and reverted —
   it made the boxes bigger than anyone wanted, and a flexed region can be
   squeezed below its children's minimum, which is what painted the diff
   disclosure over the Before box. Fixed rows plus content-sized columns means
   the modal body is the ONE scroller and nothing can ever be clipped.

   Two things here are NOT original. The New file / Modified file sub-tabs ride
   in the Filename field's `right` slot instead of owning a row. And REQ-60's
   "Preview generated diff" disclosure has moved out entirely, to the modal's
   bottom zone (`EvalCaseEditor.tsx`), below both columns.
   This file is skill-only; the agent arm reads none of it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, Textarea, TextInput } from "@devdigest/ui";
import { s } from "./styles";

export type CodeSourceKind = "new_file" | "modified_file";

export interface CodeInputValue {
  kind: CodeSourceKind;
  filename: string;
  before: string;
  after: string;
}

export interface CodeInputProps {
  /** Controlled value — see the FIX-2 note above. */
  value: CodeInputValue;
  onChange: (value: CodeInputValue) => void;
}

export function CodeInput({ value, onChange }: CodeInputProps) {
  const t = useTranslations("eval.caseEditor");
  const fieldId = React.useId();
  const filenameId = `${fieldId}-filename`;

  const prMetaReason = t("tabs.prMetaDisabledReason");
  const prMetaAccessibleName = `${t("tabs.prMeta")} — ${prMetaReason}`;
  const modified = value.kind === "modified_file";

  return (
    <FormField label={t("inputLabel")}>
      {/* REQ-53: Code | PR meta — no Diff tab for a skill case. */}
      <div role="tablist" aria-label={t("inputLabel")} style={s.tabList}>
        <button type="button" role="tab" aria-selected={true} style={s.tabButton(true, false)}>
          {t("tabs.code")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={false}
          aria-label={prMetaAccessibleName}
          title={prMetaReason}
          disabled
          style={s.tabButton(false, true)}
        >
          {t("tabs.prMeta")}
        </button>
      </div>

      {/* Code sub-tabs — New file (one After editor) or Modified file (Before +
          After) — ride in the Filename field's `right` slot rather than on a
          row of their own. The source's KIND and its NAME are one decision,
          and the row they used to own cost ~46px of modal for nothing. */}
      <FormField
        label={t("codeInput.filenameLabel")}
        htmlFor={filenameId}
        right={
          <div role="tablist" aria-label={t("codeInput.subTabsAriaLabel")} style={s.subTabList}>
            <button
              type="button"
              role="tab"
              aria-selected={!modified}
              onClick={() => onChange({ ...value, kind: "new_file" })}
              style={s.subTabButton(!modified)}
            >
              {t("tabs.newFile")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={modified}
              onClick={() => onChange({ ...value, kind: "modified_file" })}
              style={s.subTabButton(modified)}
            >
              {t("tabs.modifiedFile")}
            </button>
          </div>
        }
      >
        <TextInput
          id={filenameId}
          value={value.filename}
          onChange={(v) => onChange({ ...value, filename: v })}
          placeholder={t("codeInput.filenamePlaceholder")}
        />
      </FormField>

      {/* DOM order is load-bearing: EvalCaseEditor.test.tsx reads these
          positionally (Before, then After, then Expected output) because the
          kit `Textarea` forwards neither `id` nor `aria-label`. */}
      {modified && (
        <FormField label={t("codeInput.beforeLabel")}>
          <Textarea mono rows={6} value={value.before} onChange={(v) => onChange({ ...value, before: v })} />
        </FormField>
      )}

      <FormField label={t("codeInput.afterLabel")}>
        <Textarea
          mono
          rows={modified ? 6 : 12}
          value={value.after}
          onChange={(v) => onChange({ ...value, after: v })}
        />
      </FormField>

      {/* An empty `after` source warns but never blocks save (`canSubmit`
          in EvalCaseEditor.tsx does not check this field). */}
      {value.after.trim() === "" && <p style={s.warning}>{t("codeInput.emptyAfterWarning")}</p>}
    </FormField>
  );
}

export default CodeInput;
