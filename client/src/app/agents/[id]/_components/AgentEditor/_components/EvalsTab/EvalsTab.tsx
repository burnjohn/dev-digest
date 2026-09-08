"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SectionLabel } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import type { EvalCase, EvalCaseOutcome, EvalRun } from "@devdigest/shared/contracts/knowledge";
import {
  useEvalCases,
  useEvalRun,
  useEvalRuns,
  useStartEvalRun,
  useDeleteEvalCase,
} from "@/lib/hooks/eval";
import { useToast } from "@/lib/toast";
import { ApiError } from "@/lib/api";
import { CaseList, CaseEditorPanel } from "@/components/eval-case-editor";
import { MetricTiles } from "./MetricTiles";
import { NewAgentCaseModal } from "./NewAgentCaseModal";
import { RunHistory } from "./RunHistory";
import { s } from "./styles";

/**
 * AC-36 … AC-39, AC-46 … AC-48 — the agent editor's Evals tab: metric tiles
 * from the latest completed run, the case list, and run history.
 *
 * Q3 (background run + polling, no SSE): a run started from here is polled
 * via `useEvalRun` only while `status === 'running'`; on completion the runs/
 * dashboard/agent-detail caches are invalidated so the case list's pass/fail
 * and the tiles reflect the finished run without a manual refresh. AC-56: the
 * polled status is announced through a `role="status" aria-live="polite"`
 * region.
 */
export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("eval");
  const toast = useToast();
  const { data: cases, isLoading: casesLoading } = useEvalCases(agent.id);
  const { data: runs } = useEvalRuns(agent.id);
  const startRun = useStartEvalRun();
  const deleteCase = useDeleteEvalCase();

  const [openCaseId, setOpenCaseId] = React.useState<string | null>(null);
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const [showNewCaseModal, setShowNewCaseModal] = React.useState(false);

  const latestRun = runs?.[0] ?? null;
  const latestCompleted = React.useMemo(() => runs?.find((r) => r.status === "completed") ?? null, [runs]);

  // A run already in flight when this tab mounted (started elsewhere, or a
  // page reload mid-run) is picked up so the aria-live region still reflects
  // reality, not just runs THIS session started.
  React.useEffect(() => {
    if (latestRun?.status === "running" && activeRunId == null) setActiveRunId(latestRun.id);
  }, [latestRun, activeRunId]);

  const { data: polledRun } = useEvalRun(activeRunId);
  const isRunning = polledRun ? polledRun.status === "running" : activeRunId != null;

  React.useEffect(() => {
    if (activeRunId && polledRun && polledRun.status !== "running") {
      setActiveRunId(null);
    }
  }, [activeRunId, polledRun]);

  const outcomesByCaseId = React.useMemo(() => mapOutcomes(latestCompleted), [latestCompleted]);

  const runNow = () => {
    startRun.mutate(agent.id, {
      onSuccess: (result) => setActiveRunId(result.run_id),
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : t("run.refused.generic"));
      },
    });
  };

  const handleDelete = (evalCase: EvalCase) => {
    if (typeof window !== "undefined" && !window.confirm(t("evalsTab.deleteConfirm"))) return;
    deleteCase.mutate({ id: evalCase.id, ownerId: evalCase.owner_id });
  };

  return (
    <div style={s.wrap}>
      <div>
        <div style={s.header}>
          <h2 style={s.h2}>{t("evalsTab.metricsTitle")}</h2>
          <div style={s.headSpacer}>
            <Button
              kind="primary"
              size="sm"
              icon="Play"
              onClick={runNow}
              disabled={isRunning || !cases || cases.length === 0}
              loading={isRunning}
            >
              {isRunning
                ? t("evalsTab.running")
                : t("dashboard.runEval", { count: cases?.length ?? 0 })}
            </Button>
          </div>
        </div>
        <p style={s.hint}>{t("evalsTab.metricsSubtitle")}</p>
        <div role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {activeRunId ? t("evalsTab.runStatus", { status: polledRun ? t(`status.${polledRun.status}`) : t("status.running") }) : ""}
        </div>
      </div>

      {!cases || cases.length === 0 ? (
        casesLoading ? null : (
          <MetricTiles run={null} />
        )
      ) : !latestCompleted ? (
        <>
          <MetricTiles run={null} />
          <p style={s.hint}>{t("empty.neverRun")}</p>
        </>
      ) : (
        <>
          <MetricTiles run={latestCompleted} />
          {runs && runs.filter((r) => r.status === "completed").length === 1 && (
            <p style={s.hint}>{t("empty.oneRun")}</p>
          )}
        </>
      )}

      <div style={s.section}>
        <div style={s.sectionHead}>
          <SectionLabel icon="ListChecks">{t("evalsTab.casesHeading")}</SectionLabel>
          <div style={s.headSpacer}>
            <Button kind="secondary" size="sm" icon="Plus" onClick={() => setShowNewCaseModal(true)}>
              {t("caseEditor.newCase")}
            </Button>
          </div>
        </div>
        <CaseList
          cases={cases}
          isLoading={casesLoading}
          outcomesByCaseId={outcomesByCaseId}
          runDisabled={isRunning}
          onOpen={setOpenCaseId}
          onRun={runNow}
          onDelete={handleDelete}
        />
      </div>

      <div style={s.section}>
        <SectionLabel icon="History">{t("dashboard.recentRuns")}</SectionLabel>
        <RunHistory agentId={agent.id} runs={runs} />
      </div>

      {openCaseId && (
        <CaseEditorPanel
          caseId={openCaseId}
          outcome={outcomesByCaseId.get(openCaseId) ?? null}
          onClose={() => setOpenCaseId(null)}
        />
      )}

      {showNewCaseModal && <NewAgentCaseModal agent={agent} onClose={() => setShowNewCaseModal(false)} />}
    </div>
  );
}

function mapOutcomes(run: { metrics: EvalRun | null } | null): Map<string, EvalCaseOutcome> {
  const map = new Map<string, EvalCaseOutcome>();
  for (const outcome of run?.metrics?.per_case ?? []) map.set(outcome.case_id, outcome);
  return map;
}
