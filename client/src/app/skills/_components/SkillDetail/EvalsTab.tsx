"use client";

/* EvalsTab — skill Evals tab (Step 8 of docs/plans/2026-07-06-skill-eval-
   pipeline.md). Thin container: metrics strip + host-agent selector + case
   list + Case Editor + batch history. The full-run trigger lives in the
   SkillDetail header ("Run on evals"): this component exposes `runAll` via a
   ref and reports its disabled/loading state up via `onRunStateChange`, so
   there is no separate in-tab run button. Mirrors the agent-eval EvalsTab's
   container-component pattern (adapted vocabulary: judge score / grounding
   pass rate / cases passing, NOT recall/precision/citation-accuracy). */

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Skeleton } from "@devdigest/ui";
import type { Skill, SkillEvalCaseListItem } from "@devdigest/shared";
import {
  useSkillEvals,
  useSkillEvalBatchHistory,
  useRunSkillEvalBatch,
  useSkillEvalBatchDetail,
  useDeleteSkillEval,
  useSkillEvalTrend,
  useSkillEvalKpiDelta,
  useClearSkillEvalHistory,
} from "@/lib/hooks/skills";
import { useAgents } from "@/lib/hooks/agents";
import { ConfirmModal } from "@/components/confirm-modal";
import { HostAgentSelect } from "./_components/EvalsTab/_components/HostAgentSelect/HostAgentSelect";
import { SkillEvalMetrics } from "./_components/EvalsTab/_components/SkillEvalMetrics/SkillEvalMetrics";
import { SkillCaseList } from "./_components/EvalsTab/_components/SkillCaseList/SkillCaseList";
import { SkillCaseEditor } from "./_components/EvalsTab/_components/SkillCaseEditor/SkillCaseEditor";
import { SkillEvalBatchHistory } from "./_components/EvalsTab/_components/SkillEvalBatchHistory/SkillEvalBatchHistory";
import { SkillTrendChart } from "./_components/EvalsTab/_components/SkillTrendChart/SkillTrendChart";
import { SkillKpiDeltaStrip } from "./_components/EvalsTab/_components/SkillKpiDeltaStrip/SkillKpiDeltaStrip";
import { s } from "./_components/EvalsTab/styles";

export interface EvalsTabHandle {
  /** Fire a full-set eval run (all cases) with the currently-selected host
      agent. No-op if no host agent is selected or a run is already in flight. */
  runAll: () => void;
}

interface EvalsTabProps {
  skill: Skill;
  /** Reports run availability + in-flight state up to the parent so the header
      "Run on evals" button can drive its own disabled / loading appearance. */
  onRunStateChange?: (state: { canRunAll: boolean; running: boolean }) => void;
}

export const EvalsTab = React.forwardRef<EvalsTabHandle, EvalsTabProps>(function EvalsTab(
  { skill, onRunStateChange },
  ref,
) {
  const t = useTranslations("skills");
  const { data: cases, isLoading: loadingCases } = useSkillEvals(skill.id);
  const { data: batches, isLoading: loadingBatches } = useSkillEvalBatchHistory(skill.id);
  const { data: trendPoints, isLoading: loadingTrend } = useSkillEvalTrend(skill.id);
  const { data: kpiDelta, isLoading: loadingKpiDelta } = useSkillEvalKpiDelta(skill.id);
  const { data: agents } = useAgents();
  const runBatch = useRunSkillEvalBatch(skill.id);
  const deleteCase = useDeleteSkillEval(skill.id);
  const clearHistory = useClearSkillEvalHistory(skill.id);

  const qc = useQueryClient();
  const [selectedHostAgentId, setSelectedHostAgentId] = React.useState<string | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingCase, setEditingCase] = React.useState<SkillEvalCaseListItem | null>(null);
  const [runningCaseId, setRunningCaseId] = React.useState<string | null>(null);
  const [pendingBatchId, setPendingBatchId] = React.useState<string | null>(null);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = React.useState(false);
  // Batch id hovered on the trend chart — highlights + scrolls its Batch
  // History row (chart ⇄ table link, instead of a duplicate list under the chart).
  const [highlightedBatchId, setHighlightedBatchId] = React.useState<string | null>(null);

  // The run route returns 202 BEFORE the batch executes, so poll the just-
  // fired batch until the server seals it (status != null), then refresh the
  // case statuses + history. Without this the metrics/statuses/history would
  // never update until a manual page reload. Mirrors hooks/eval.ts's
  // useEvalRunCompletion pattern; useSkillEvalBatchDetail self-polls while
  // status is null and stops once sealed.
  const pendingBatch = useSkillEvalBatchDetail(skill.id, pendingBatchId);
  const running = runBatch.isPending || pendingBatchId != null;

  React.useEffect(() => {
    if (pendingBatchId && pendingBatch.data?.status != null) {
      qc.invalidateQueries({ queryKey: ["skill-evals", skill.id] });
      qc.invalidateQueries({ queryKey: ["skill-eval-batches", skill.id] });
      setPendingBatchId(null);
      setRunningCaseId(null);
    }
  }, [pendingBatchId, pendingBatch.data?.status, qc, skill.id]);

  const list = cases ?? [];
  const batchList = batches ?? [];
  // Server sorts batch history `ORDER BY ran_at DESC` — newest first.
  const latestBatch = batchList[0] ?? null;
  const passedCount = list.filter((c) => c.last_run_status === "passed").length;

  const openNewCase = () => {
    setEditingCase(null);
    setEditorOpen(true);
  };

  const openEditCase = (evalCase: SkillEvalCaseListItem) => {
    setEditingCase(evalCase);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingCase(null);
  };

  const runCase = (caseId: string) => {
    if (!selectedHostAgentId || running) return;
    setRunningCaseId(caseId);
    runBatch.mutate(
      { case_ids: [caseId], host_agent_id: selectedHostAgentId },
      {
        onSuccess: (res) => setPendingBatchId(res.batch_id),
        // The batch never started — the completion effect won't fire, so
        // release the per-row spinner here.
        onError: () => setRunningCaseId(null),
      },
    );
  };

  const runAll = () => {
    if (!selectedHostAgentId || running) return;
    runBatch.mutate(
      { host_agent_id: selectedHostAgentId },
      { onSuccess: (res) => setPendingBatchId(res.batch_id) },
    );
  };

  // The full-run trigger lives in the SkillDetail header ("Run on evals").
  // Expose runAll imperatively and report the reactive disabled/loading state
  // up so that header button reflects it (disabled while no host agent is
  // selected, no cases exist, or a run is in flight; loading while running).
  const canRunAll = !!selectedHostAgentId && !running && (cases?.length ?? 0) > 0;
  React.useImperativeHandle(ref, () => ({ runAll }), [runAll]);
  React.useEffect(() => {
    onRunStateChange?.({ canRunAll, running });
  }, [canRunAll, running, onRunStateChange]);

  const isLoading = loadingCases || loadingBatches || loadingTrend;

  if (isLoading) {
    return (
      <div style={s.wrap}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={56} style={{ marginBottom: 8 }} />
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div style={s.wrap}>
        <EmptyState
          icon="FlaskConical"
          title={t("evals.empty.title")}
          body={t("evals.empty.hint")}
          cta={t("evals.empty.cta")}
          onCta={openNewCase}
        />
        {editorOpen && <SkillCaseEditor skillId={skill.id} initialCase={editingCase} onClose={closeEditor} />}
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <SkillEvalMetrics latestBatch={latestBatch} />

      <div style={s.headerRow}>
        <div style={s.titleRow}>
          <h2 style={s.title}>{t("evals.casesTitle")}</h2>
          <span style={s.passingBadge}>{t("evals.passing", { passed: passedCount, total: list.length })}</span>
        </div>
        <Button kind="primary" size="sm" onClick={openNewCase}>
          {t("evals.newCase")}
        </Button>
      </div>

      <div style={s.runControls}>
        <HostAgentSelect value={selectedHostAgentId} onChange={setSelectedHostAgentId} />
      </div>

      <SkillCaseList
        cases={list}
        runningCaseId={runningCaseId}
        runDisabled={!selectedHostAgentId || running}
        onRunCase={runCase}
        onEditCase={openEditCase}
        onDeleteCase={(caseId) => deleteCase.mutate(caseId)}
      />

      <div style={s.headerRow}>
        <div style={s.sectionLabel}>{t("evals.history.title")}</div>
        <Button
          kind="danger"
          size="sm"
          onClick={() => setClearHistoryConfirmOpen(true)}
          disabled={clearHistory.isPending || batchList.length === 0}
        >
          {t("evals.history.clearHistory")}
        </Button>
      </div>
      <SkillEvalBatchHistory
        skillId={skill.id}
        batches={batchList}
        agents={agents ?? []}
        highlightBatchId={highlightedBatchId}
      />

      <div style={s.sectionLabel}>{t("evals.trend.title")}</div>
      <SkillKpiDeltaStrip delta={kpiDelta} isLoading={loadingKpiDelta} />
      <SkillTrendChart points={trendPoints ?? []} onHighlightBatch={setHighlightedBatchId} />

      {editorOpen && <SkillCaseEditor skillId={skill.id} initialCase={editingCase} onClose={closeEditor} />}

      {clearHistoryConfirmOpen && (
        <ConfirmModal
          title={t("evals.history.clearHistoryConfirmTitle")}
          body={t("evals.history.clearHistoryConfirmBody")}
          confirmLabel={t("evals.history.clearHistoryConfirmConfirm")}
          cancelLabel={t("evals.history.clearHistoryConfirmCancel")}
          danger
          onConfirm={() => {
            clearHistory.mutate();
            setClearHistoryConfirmOpen(false);
          }}
          onCancel={() => setClearHistoryConfirmOpen(false)}
        />
      )}
    </div>
  );
});
