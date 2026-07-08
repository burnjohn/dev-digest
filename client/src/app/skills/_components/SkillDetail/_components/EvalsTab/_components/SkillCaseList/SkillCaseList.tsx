"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { SkillEvalCaseListItem } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import { SkillCaseRow } from "../SkillCaseRow/SkillCaseRow";
import { s } from "../../styles";

interface SkillCaseListProps {
  cases: SkillEvalCaseListItem[];
  runningCaseId: string | null;
  runDisabled?: boolean;
  onRunCase: (caseId: string) => void;
  onEditCase: (evalCase: SkillEvalCaseListItem) => void;
  onDeleteCase: (caseId: string) => void;
}

export function SkillCaseList({
  cases,
  runningCaseId,
  runDisabled,
  onRunCase,
  onEditCase,
  onDeleteCase,
}: SkillCaseListProps) {
  const t = useTranslations("skills");
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
        <SkillCaseRow
          key={evalCase.id}
          evalCase={evalCase}
          isRunning={runningCaseId === evalCase.id}
          runDisabled={!!runDisabled}
          onRun={() => onRunCase(evalCase.id)}
          onEdit={() => onEditCase(evalCase)}
          onDelete={() => setPendingDeleteId(evalCase.id)}
        />
      ))}
    </div>
  );
}
