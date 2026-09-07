"use client";

import { useTranslations } from "next-intl";
import { EmptyState, Skeleton } from "@devdigest/ui";
import type { EvalCase, EvalCaseEffect, EvalCaseOutcome } from "@devdigest/shared/contracts/knowledge";
import { CaseRow } from "./CaseRow";
import { s } from "./styles";

/**
 * AC-37/AC-46 (agent) / AC-35 (skill) — an owner's eval cases.
 * `outcomesByCaseId` is the latest COMPLETED run's `per_case` array, keyed by
 * case id (empty map when the owner has never completed a run — every row
 * then shows "—" instead of a stale or fake result).
 *
 * `originByCaseId`/`effectByCaseId` are additive, optional (client/LEARNINGS.md
 * 2026-08-21) — undefined for the agent tab's call site, which threads
 * nothing new to `CaseRow` and renders exactly as before this widening
 * (specs/15-skill-eval-cases.md plan §11).
 */
export function CaseList({
  cases,
  isLoading,
  outcomesByCaseId,
  runDisabled,
  onOpen,
  onRun,
  onDelete,
  originByCaseId,
  effectByCaseId,
  emptyBody,
}: {
  cases: EvalCase[] | undefined;
  isLoading: boolean;
  outcomesByCaseId: Map<string, EvalCaseOutcome>;
  runDisabled: boolean;
  onOpen: (caseId: string) => void;
  onRun: () => void;
  onDelete: (evalCase: EvalCase) => void;
  originByCaseId?: Map<string, "finding" | "hand">;
  effectByCaseId?: Map<string, EvalCaseEffect | null>;
  /** Overrides the default agent-tab empty-state copy — the skill tab's
   *  empty state (AC-37) names a different creation path. */
  emptyBody?: string;
}) {
  const t = useTranslations("eval");

  if (isLoading) {
    return (
      <div style={s.list}>
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (!cases || cases.length === 0) {
    return (
      <EmptyState icon="ListChecks" title={t("evalsTab.casesHeading")} body={emptyBody ?? t("empty.noCases")} />
    );
  }

  return (
    <div style={s.list}>
      {cases.map((c) => (
        <CaseRow
          key={c.id}
          evalCase={c}
          outcome={outcomesByCaseId.get(c.id) ?? null}
          runDisabled={runDisabled}
          onOpen={() => onOpen(c.id)}
          onRun={onRun}
          onDelete={() => onDelete(c)}
          origin={originByCaseId?.get(c.id)}
          effect={effectByCaseId ? (effectByCaseId.get(c.id) ?? null) : undefined}
        />
      ))}
    </div>
  );
}
