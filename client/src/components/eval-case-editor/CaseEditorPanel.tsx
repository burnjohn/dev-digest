"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, TextInput, Textarea, SelectInput, Skeleton, Tabs } from "@devdigest/ui";
import type { EvalCaseOutcome, EvalExpectationType } from "@devdigest/shared/contracts/knowledge";
import { useEvalCase, useUpdateEvalCase } from "@/lib/hooks/eval";
import { useToast } from "@/lib/toast";
import { DiffInputField } from "./DiffInputField";
import { EXPECTATION_TYPES } from "./constants";
import { s } from "./styles";

/**
 * AC-39 (agent) / AC-36 (skill) — WHEN a user opens a case: name, frozen
 * input split into diff / files / PR metadata, the expectation in an
 * editable form, and its outcome in the latest run that covered it. AC-12/
 * AC-13: name, notes, frozen input and expectation are all editable here;
 * the server re-validates on save (frozen-input.ts) and 422s a rejected edit
 * with a stated reason.
 *
 * Recommendation followed (plan §8): a panel inside the tab, not a route —
 * AC-39 says "opens a case", never "navigates to".
 *
 * `withoutOutcome` is an additive, optional prop (client/LEARNINGS.md
 * 2026-08-21 — gated on `!== undefined`, not truthiness, so a `null`
 * without-arm outcome — e.g. this case errored out of the pair — still
 * renders the side-by-side layout with its own "no outcome" message). The
 * agent tab's call site never supplies it and renders exactly as before this
 * widening (specs/15-skill-eval-cases.md plan §11, AC-36's side-by-side arms).
 */
export function CaseEditorPanel({
  caseId,
  outcome,
  withoutOutcome,
  onClose,
}: {
  caseId: string;
  outcome: EvalCaseOutcome | null;
  withoutOutcome?: EvalCaseOutcome | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data: evalCase, isLoading } = useEvalCase(caseId);
  const update = useUpdateEvalCase();
  const [inputTab, setInputTab] = React.useState<"diff" | "prMeta">("diff");

  const [name, setName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [diff, setDiff] = React.useState("");
  const [files, setFiles] = React.useState("");
  const [prTitle, setPrTitle] = React.useState("");
  const [prBody, setPrBody] = React.useState("");
  const [expType, setExpType] = React.useState<EvalExpectationType>("must_find");
  const [expFile, setExpFile] = React.useState("");
  const [expStart, setExpStart] = React.useState(1);
  const [expEnd, setExpEnd] = React.useState(1);
  const [expSeverity, setExpSeverity] = React.useState("");
  const [expCategory, setExpCategory] = React.useState("");

  // Seed local form state once the case loads (not on every re-render).
  const seededFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!evalCase || seededFor.current === evalCase.id) return;
    seededFor.current = evalCase.id;
    setName(evalCase.name);
    setNotes(evalCase.notes ?? "");
    setDiff(evalCase.input_diff);
    setFiles(evalCase.input_files.join(", "));
    setPrTitle(evalCase.input_meta.title);
    setPrBody(evalCase.input_meta.body ?? "");
    setExpType(evalCase.expectation.type);
    setExpFile(evalCase.expectation.file);
    setExpStart(evalCase.expectation.start_line);
    setExpEnd(evalCase.expectation.end_line);
    setExpSeverity(evalCase.expectation.severity ?? "");
    setExpCategory(evalCase.expectation.category ?? "");
  }, [evalCase]);

  if (isLoading || !evalCase) {
    return (
      <Modal onClose={onClose}>
        <div style={s.form}>
          <Skeleton height={20} />
          <Skeleton height={80} />
        </div>
      </Modal>
    );
  }

  const save = () => {
    update.mutate(
      {
        id: caseId,
        patch: {
          name,
          notes: notes || null,
          input_diff: diff,
          input_files: files
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean),
          input_meta: { pr_number: evalCase.input_meta.pr_number, title: prTitle, body: prBody || null },
          expectation: {
            type: expType,
            file: expFile,
            start_line: expStart,
            end_line: expEnd,
            severity: expSeverity || null,
            category: expCategory || null,
            title: evalCase.expectation.title ?? null,
          },
        },
      },
      {
        onSuccess: () => {
          toast.success(t("caseEditor.save"));
          onClose();
        },
        onError: () => toast.error(t("caseEditor.save")),
      },
    );
  };

  return (
    <Modal title={t("caseEditor.caseTitle", { name: evalCase.name })} onClose={onClose} width={720}>
      <div style={s.form}>
        <div style={s.formField}>
          <label style={s.label} htmlFor="eval-case-name">
            {t("caseEditor.nameLabel")}
          </label>
          <TextInput id="eval-case-name" value={name} onChange={setName} />
        </div>

        <div style={s.formField}>
          <span style={s.label}>{t("caseEditorPanel.outcomeTitle")}</span>
          {withoutOutcome !== undefined ? (
            <div style={s.formRow}>
              <div style={s.formField}>
                <span style={s.label}>{t("skill.withArm")}</span>
                <OutcomeSummary outcome={outcome} />
              </div>
              <div style={s.formField}>
                <span style={s.label}>{t("skill.withoutArm")}</span>
                <OutcomeSummary outcome={withoutOutcome} />
              </div>
            </div>
          ) : (
            <OutcomeSummary outcome={outcome} />
          )}
        </div>

        <div style={s.formField}>
          <span style={s.label}>{t("caseEditor.inputLabel")}</span>
          <Tabs
            tabs={[
              { key: "diff", label: t("caseEditor.tabs.diff") },
              { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
            ]}
            value={inputTab}
            onChange={(k) => setInputTab(k as "diff" | "prMeta")}
            pad="0"
          />
          {inputTab === "diff" ? (
            <DiffInputField
              diff={diff}
              onDiffChange={setDiff}
              files={files}
              onFilesChange={setFiles}
              filesId="eval-case-files"
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={s.formField}>
                <label style={s.label} htmlFor="eval-case-pr-title">
                  {t("caseEditorPanel.prTitleLabel")}
                </label>
                <TextInput id="eval-case-pr-title" value={prTitle} onChange={setPrTitle} />
              </div>
              <div style={s.formField}>
                <label style={s.label} htmlFor="eval-case-pr-body">
                  {t("caseEditorPanel.prBodyLabel")}
                </label>
                <Textarea value={prBody} onChange={setPrBody} rows={4} />
              </div>
            </div>
          )}
        </div>

        <div style={s.formField}>
          <span style={s.label}>{t("caseEditorPanel.expectationTitle")}</span>
          <div style={s.formRow}>
            <div style={s.formField}>
              <label style={s.label} htmlFor="eval-case-exp-type">
                {t("caseEditorPanel.expectationType")}
              </label>
              <SelectInput
                value={expType}
                onChange={(v) => setExpType(v as EvalExpectationType)}
                options={EXPECTATION_TYPES.map((v) => ({
                  value: v,
                  label: v === "must_find" ? t("expectation.mustFind") : t("expectation.mustNotFlag"),
                }))}
              />
            </div>
            <div style={s.formField}>
              <label style={s.label} htmlFor="eval-case-exp-file">
                {t("caseEditorPanel.expectationFile")}
              </label>
              <TextInput id="eval-case-exp-file" value={expFile} onChange={setExpFile} mono />
            </div>
          </div>
          <div style={s.formRow}>
            <div style={s.formField}>
              <label style={s.label} htmlFor="eval-case-exp-start">
                {t("caseEditorPanel.expectationStartLine")}
              </label>
              <TextInput
                id="eval-case-exp-start"
                type="number"
                value={String(expStart)}
                onChange={(v) => setExpStart(Number(v) || 0)}
              />
            </div>
            <div style={s.formField}>
              <label style={s.label} htmlFor="eval-case-exp-end">
                {t("caseEditorPanel.expectationEndLine")}
              </label>
              <TextInput
                id="eval-case-exp-end"
                type="number"
                value={String(expEnd)}
                onChange={(v) => setExpEnd(Number(v) || 0)}
              />
            </div>
          </div>
          <div style={s.formRow}>
            <div style={s.formField}>
              <label style={s.label} htmlFor="eval-case-exp-severity">
                {t("caseEditorPanel.expectationSeverity")}
              </label>
              <TextInput id="eval-case-exp-severity" value={expSeverity} onChange={setExpSeverity} />
            </div>
            <div style={s.formField}>
              <label style={s.label} htmlFor="eval-case-exp-category">
                {t("caseEditorPanel.expectationCategory")}
              </label>
              <TextInput id="eval-case-exp-category" value={expCategory} onChange={setExpCategory} />
            </div>
          </div>
        </div>

        <div style={s.formField}>
          <label style={s.label} htmlFor="eval-case-notes">
            {t("caseEditorPanel.notesLabel")}
          </label>
          <Textarea value={notes} onChange={setNotes} rows={2} />
        </div>

        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("caseEditorPanel.close")}
          </Button>
          <Button kind="primary" onClick={save} loading={update.isPending}>
            {update.isPending ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function OutcomeSummary({ outcome }: { outcome: EvalCaseOutcome | null }) {
  const t = useTranslations("eval");
  if (!outcome) return <p style={s.hint}>{t("caseEditorPanel.outcomeNone")}</p>;
  if (outcome.status === "errored") {
    return <p style={s.hint}>{t("caseEditorPanel.outcomeErrored", { reason: outcome.error_reason ?? "" })}</p>;
  }
  return (
    <p style={s.hint}>
      {outcome.pass ? t("evalsTab.passed") : t("evalsTab.failed")} —{" "}
      {t("evalsTab.matchedCount", { matched: outcome.findings_matched, total: outcome.findings_total })}
    </p>
  );
}
