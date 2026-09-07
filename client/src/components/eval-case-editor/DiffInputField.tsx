"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { TextInput, Textarea } from "@devdigest/ui";
import { DiffViewer, parseMultiFileDiff } from "@/components/diff-viewer";
import { s } from "./styles";

/**
 * The diff-fragment half of the case editor's "Diff" tab, shared between
 * `NewSkillCaseModal` and `CaseEditorPanel` (agent + skill, create + edit
 * all funnel through this one field). Renders a live `DiffViewer` preview
 * below the raw textarea, parsed via `parseMultiFileDiff` — best-effort: a
 * paste that doesn't parse as a unified diff just shows no preview, never an
 * error blocking the form (the textarea's raw text is still what gets saved).
 */
export function DiffInputField({
  diff,
  onDiffChange,
  files,
  onFilesChange,
  filesId,
  diffPlaceholder,
}: {
  diff: string;
  onDiffChange: (v: string) => void;
  files: string;
  onFilesChange: (v: string) => void;
  filesId: string;
  diffPlaceholder?: string;
}) {
  const t = useTranslations("eval");
  const parsedFiles = React.useMemo(() => parseMultiFileDiff(diff), [diff]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Textarea value={diff} onChange={onDiffChange} rows={8} mono placeholder={diffPlaceholder} />
      <div style={s.formField}>
        <label style={s.label} htmlFor={filesId}>
          {t("caseEditorPanel.filesLabel")}
        </label>
        <TextInput id={filesId} value={files} onChange={onFilesChange} mono />
      </div>
      {parsedFiles.length > 0 && (
        <div style={s.formField}>
          <span style={s.label}>{t("caseEditor.preview")}</span>
          <DiffViewer files={parsedFiles} />
        </div>
      )}
    </div>
  );
}
