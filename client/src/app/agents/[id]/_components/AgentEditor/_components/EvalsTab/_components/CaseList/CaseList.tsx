"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalCaseListItem } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import { CaseRow } from "../CaseRow/CaseRow";
import { evalStyles as s } from "@/components/eval";

interface CaseListProps {
  cases: EvalCaseListItem[];
  runningCaseId: string | null;
  /** True whenever ANY batch run is in flight (per-case or run-all) — disables
      every row's Run button so a Run-all can't overlap a per-case run and
      vice versa (S4). */
  runDisabled?: boolean;
  onRunCase: (caseId: string) => void;
  onEditCase: (evalCase: EvalCaseListItem) => void;
  onDeleteCase: (caseId: string) => void;
}

/** Subtitle for a case row: an explicit empty-set indicator for a "clean
    diff" case with zero expectations (AC-9), otherwise the server's own
    `last_run_summary` verbatim — the server (`summaryForRun`) already adapts
    the wording per expectation type (including the must_not_flag-only
    phrasing), so the client renders it as-is with no re-derivation here. */
function subtitleFor(
  evalCase: EvalCaseListItem,
  t: ReturnType<typeof useTranslations>,
): string | null {
  if (evalCase.expected_output.length === 0) {
    return t("evals.summary.emptyExpectedOutput");
  }
  return evalCase.last_run_summary ?? null;
}

export function CaseList({ cases, runningCaseId, runDisabled, onRunCase, onEditCase, onDeleteCase }: CaseListProps) {
  const t = useTranslations("agents");
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);

  const pendingDeleteCase = cases.find((c) => c.id === pendingDeleteId) ?? null;

  return (
    <div style={s.list}>
      {pendingDeleteCase && (
        <ConfirmModal
          title={t("evals.case.deleteConfirmTitle")}
          body={t("evals.case.deleteConfirmBody", { name: pendingDeleteCase.name })}
          confirmLabel={t("evals.case.deleteConfirmConfirm")}
          cancelLabel={t("evals.case.deleteConfirmCancel")}
          danger
          onConfirm={() => {
            onDeleteCase(pendingDeleteCase.id);
            setPendingDeleteId(null);
          }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
      {cases.map((evalCase) => (
        <CaseRow
          key={evalCase.id}
          evalCase={evalCase}
          statusLabel={t(`evals.status.${evalCase.last_run_status}`)}
          subtitle={subtitleFor(evalCase, t)}
          runLabel={t("evals.case.run")}
          editLabel={t("evals.case.edit")}
          deleteLabel={t("evals.case.delete")}
          onRun={() => onRunCase(evalCase.id)}
          onEdit={() => onEditCase(evalCase)}
          onDelete={() => setPendingDeleteId(evalCase.id)}
          isRunning={runningCaseId === evalCase.id}
          runDisabled={!!runDisabled}
        />
      ))}
    </div>
  );
}
