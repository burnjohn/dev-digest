"use client";

/* SkillCaseEditor — modal for authoring / editing a skill eval case. Uses the
   SIMPLE single-textarea fixture pattern (per the spec's explicit non-goal —
   NOT the agent-eval side's two-panel source-aware redesign). Practices and
   grounding are add/remove text-row list editors (via TextRowListEditor);
   threshold is a validated number input (0–1, default 0.6, inline error on
   out-of-range — AC-39).

   Save calls `useCreateSkillEval` (create) or `useUpdateSkillEvalCase` (edit)
   with the `SkillEvalCaseCreateInput` shape. The server's AC-2/AC-3/AC-39
   validation errors are surfaced inline on failure without closing the
   modal — this component never optimistically closes before success. */

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Textarea, TextInput } from "@devdigest/ui";
import type { SkillEvalCaseListItem, SkillEvalCaseCreateInput } from "@devdigest/shared";
import { useCreateSkillEval, useUpdateSkillEvalCase } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { DiffViewer, rawDiffToPrFiles } from "@/components/diff-viewer";
import { TextRowListEditor, type TextListRow } from "./TextRowListEditor";
import { s } from "../../styles";

interface SkillCaseEditorProps {
  skillId: string;
  /** When set, pre-fills the form for editing an existing case in place —
      save calls the update mutation (PATCH) instead of creating a new case. */
  initialCase?: SkillEvalCaseListItem | null;
  onClose: () => void;
}

const DEFAULT_THRESHOLD = 0.6;

function nextListKey(seq: { current: number }) {
  seq.current += 1;
  return `row-${seq.current}`;
}

/** Add/update/remove helpers for a `TextListRow[]` state slice — shared by
    the practices and grounding editors below. */
function useTextRowList(initial: string[], keySeq: React.MutableRefObject<number>) {
  const [rows, setRows] = React.useState<TextListRow[]>(
    initial.length ? initial.map((v) => ({ key: nextListKey(keySeq), value: v })) : [],
  );
  const add = () => setRows((prev) => [...prev, { key: nextListKey(keySeq), value: "" }]);
  const change = (key: string, value: string) =>
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, value } : row)));
  const remove = (key: string) => setRows((prev) => prev.filter((row) => row.key !== key));
  const cleanValues = () => rows.map((r) => r.value.trim()).filter((v) => v.length > 0);
  return { rows, add, change, remove, cleanValues };
}

export function SkillCaseEditor({ skillId, initialCase, onClose }: SkillCaseEditorProps) {
  const t = useTranslations("skills");
  const createCase = useCreateSkillEval(skillId);
  const updateCase = useUpdateSkillEvalCase(skillId);
  const isEditing = !!initialCase;
  const activeMutation = isEditing ? updateCase : createCase;

  const keySeq = React.useRef(0);
  const [name, setName] = React.useState(initialCase?.name ?? "");
  const [fixture, setFixture] = React.useState(initialCase?.fixture ?? "");
  const [notes, setNotes] = React.useState("");
  const practices = useTextRowList(initialCase?.practices ?? [], keySeq);
  const grounding = useTextRowList(initialCase?.grounding ?? [], keySeq);
  const [threshold, setThreshold] = React.useState(String(initialCase?.threshold ?? DEFAULT_THRESHOLD));
  const [error, setError] = React.useState<string | null>(null);
  const [thresholdError, setThresholdError] = React.useState<string | null>(null);

  const title = isEditing ? t("evals.editor.titleEdit") : t("evals.editor.titleNew");

  const handleSave = () => {
    setError(null);
    setThresholdError(null);

    if (!fixture.trim()) {
      setError(t("evals.editor.fixtureRequired"));
      return;
    }

    const thresholdNum = Number(threshold);
    if (!Number.isFinite(thresholdNum) || thresholdNum < 0 || thresholdNum > 1) {
      setThresholdError(t("evals.editor.thresholdOutOfRange"));
      return;
    }

    const input: SkillEvalCaseCreateInput = {
      skill_id: skillId,
      name,
      fixture,
      practices: practices.cleanValues(),
      grounding: grounding.cleanValues(),
      threshold: thresholdNum,
      notes: notes || null,
    };

    const mutationOptions = {
      onSuccess: () => onClose(),
      onError: (err: unknown) => {
        setError(err instanceof ApiError ? err.message : String(err));
      },
    };

    if (initialCase) {
      updateCase.mutate({ caseId: initialCase.id, input }, mutationOptions);
    } else {
      createCase.mutate(input, mutationOptions);
    }
  };

  return (
    <Modal
      width={640}
      title={title}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button kind="ghost" size="sm" onClick={onClose}>
            {t("evals.editor.cancel")}
          </Button>
          <Button kind="primary" size="sm" onClick={handleSave} loading={activeMutation.isPending}>
            {activeMutation.isPending ? t("evals.editor.saving") : t("evals.editor.save")}
          </Button>
        </div>
      }
    >
      {error && (
        <div role="alert" style={s.errorBanner}>
          {error}
        </div>
      )}

      <div style={s.editorBody}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={s.fieldLabel}>{t("evals.editor.name")}</span>
          <TextInput value={name} onChange={setName} placeholder={t("evals.editor.namePlaceholder")} />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={s.fieldLabel}>{t("evals.editor.fixture")}</span>
          <Textarea value={fixture} onChange={setFixture} rows={7} mono placeholder={t("evals.editor.fixturePlaceholder")} />
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={s.smallLabel}>{t("evals.editor.diffPreview")}</span>
          <div style={{ maxHeight: 260, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
            <DiffViewer files={rawDiffToPrFiles(fixture)} />
          </div>
        </div>

        <TextRowListEditor
          sectionLabel={t("evals.editor.practices")}
          hint={t("evals.editor.practicesHint")}
          addLabel={t("evals.editor.addPractice")}
          removeLabel={t("evals.editor.removePractice")}
          rowPlaceholder={t("evals.editor.practicePlaceholder")}
          rows={practices.rows}
          onAdd={practices.add}
          onChange={practices.change}
          onRemove={practices.remove}
        />

        <TextRowListEditor
          sectionLabel={t("evals.editor.grounding")}
          hint={t("evals.editor.groundingHint")}
          addLabel={t("evals.editor.addGrounding")}
          removeLabel={t("evals.editor.removeGrounding")}
          rowPlaceholder={t("evals.editor.groundingPlaceholder")}
          rows={grounding.rows}
          onAdd={grounding.add}
          onChange={grounding.change}
          onRemove={grounding.remove}
          mono
        />

        <label style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 160 }}>
          <span style={s.fieldLabel}>{t("evals.editor.threshold")}</span>
          <TextInput value={threshold} onChange={setThreshold} type="number" />
          <span style={s.smallLabel}>{t("evals.editor.thresholdHint")}</span>
          {thresholdError && (
            <span role="alert" style={{ fontSize: 12, color: "var(--crit)" }}>
              {thresholdError}
            </span>
          )}
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={s.fieldLabel}>{t("evals.editor.notes")}</span>
          <Textarea value={notes} onChange={setNotes} rows={2} placeholder={t("evals.editor.notesPlaceholder")} />
        </label>
      </div>
    </Modal>
  );
}
