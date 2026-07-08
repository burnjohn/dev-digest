"use client";

/* EvalsTab — Agent Editor "Evals" tab (L06 Eval Pipeline). Case list + Case
   Editor + batch history (with drill-down + compare) + trend chart. */

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCaseListItem } from "@devdigest/shared";
import { ConfirmModal } from "@/components/confirm-modal";
import {
  useEvalCases,
  useEvalBatchHistory,
  useEvalTrend,
  useEvalKpiDelta,
  useEvalBatchDetail,
  useRunEvalBatch,
  useDeleteEvalCase,
  useEvalRunCompletion,
  useClearEvalHistory,
} from "@/lib/hooks/eval";
import { CaseList } from "./_components/CaseList/CaseList";
import { CaseEditor } from "./_components/CaseEditor/CaseEditor";
import { KpiDeltaStrip } from "./_components/KpiDeltaStrip/KpiDeltaStrip";
import { BatchHistoryTable, TrendChart, EvalMetrics, evalStyles as s } from "@/components/eval";

interface EvalsTabProps {
  agent: Agent;
}

export function EvalsTab({ agent }: EvalsTabProps) {
  const t = useTranslations("agents");
  const { data: caseData, isLoading: loadingCases } = useEvalCases(agent.id);
  const { data: batches, isLoading: loadingBatches } = useEvalBatchHistory(agent.id);
  const { data: trendPoints, isLoading: loadingTrend } = useEvalTrend(agent.id);
  const { data: kpiDelta, isLoading: loadingKpiDelta } = useEvalKpiDelta(agent.id);
  const runBatch = useRunEvalBatch(agent.id);
  const deleteCase = useDeleteEvalCase(agent.id);
  const clearHistory = useClearEvalHistory(agent.id);
  // Latest sealed full batch — feeds the "traces passed" tile of the metrics
  // infographic (passed vs total case-runs in that batch).
  const latestFullBatchId = (batches ?? []).find((b) => b.kind === "full" && b.status != null)?.id ?? null;
  const latestBatchDetail = useEvalBatchDetail(agent.id, latestFullBatchId);

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editingCase, setEditingCase] = React.useState<EvalCaseListItem | null>(null);
  const [runningCaseId, setRunningCaseId] = React.useState<string | null>(null);
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = React.useState(false);
  // Batch id hovered on the trend chart — highlights + scrolls its Batch
  // History row (chart ⇄ table link, instead of a duplicate list under the chart).
  const [highlightedBatchId, setHighlightedBatchId] = React.useState<string | null>(null);
  // #9 — the run mutation only returns `{ batch_id }` (202 Accepted); track it
  // here and let `useEvalRunCompletion` poll + invalidate the right queries
  // once the batch actually finishes (status leaves null), then stop polling
  // by clearing the id.
  const [pendingBatchId, setPendingBatchId] = React.useState<string | null>(null);
  const pendingBatch = useEvalRunCompletion(agent.id, pendingBatchId);

  React.useEffect(() => {
    if (pendingBatchId && pendingBatch.data && pendingBatch.data.status != null) {
      setPendingBatchId(null);
    }
  }, [pendingBatchId, pendingBatch.data]);

  const cases = caseData?.cases ?? [];
  const excludedCount = caseData?.excluded_skill_owned_count ?? 0;
  const passedCaseCount = cases.filter((c) => c.last_run_status === "passed").length;
  const trend = trendPoints ?? [];
  const latestPoint = trend.length ? trend[trend.length - 1]! : null;
  const detailCases = latestBatchDetail.data?.cases ?? [];
  const tracesPassed = latestBatchDetail.data ? detailCases.filter((c) => c.status === "passed").length : null;
  const tracesTotal = latestBatchDetail.data ? detailCases.length : null;

  const openNewCase = () => {
    setEditingCase(null);
    setEditorOpen(true);
  };

  const openEditCase = (evalCase: EvalCaseListItem) => {
    setEditingCase(evalCase);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingCase(null);
  };

  const runCase = (caseId: string) => {
    setRunningCaseId(caseId);
    runBatch.mutate(
      { case_ids: [caseId] },
      {
        onSuccess: (data) => setPendingBatchId(data.batch_id),
        onSettled: () => setRunningCaseId(null),
      },
    );
  };

  const runAll = () => {
    runBatch.mutate(
      {},
      { onSuccess: (data) => setPendingBatchId(data.batch_id) },
    );
  };

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

  if (cases.length === 0) {
    return (
      <div style={s.wrap}>
        <EmptyState
          icon="FlaskConical"
          title={t("evals.empty.title")}
          body={t("evals.empty.hint")}
          cta={t("evals.empty.cta")}
          onCta={openNewCase}
        />
        {editorOpen && (
          <CaseEditor
            agentId={agent.id}
            agentName={agent.name}
            initialCase={editingCase}
            onClose={closeEditor}
            onRunCase={runCase}
            runDisabled={runBatch.isPending}
          />
        )}
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <EvalMetrics
        recall={latestPoint?.recall ?? null}
        precision={latestPoint?.precision ?? null}
        citation={latestPoint?.citation_accuracy ?? null}
        delta={kpiDelta}
        tracesPassed={tracesPassed}
        tracesTotal={tracesTotal}
        agentId={agent.id}
      />
      <div style={s.headerRow}>
        <div style={s.titleRow}>
          <h2 style={s.title}>{t("evals.casesTitle")}</h2>
          <span style={s.passingBadge}>{t("evals.passing", { passed: passedCaseCount, total: cases.length })}</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            kind="secondary"
            size="sm"
            icon="Play"
            onClick={runAll}
            disabled={runBatch.isPending}
            loading={runBatch.isPending && !runningCaseId}
          >
            {t("evals.runAll")}
          </Button>
          <Button kind="primary" size="sm" onClick={openNewCase}>
            {t("evals.newCase")}
          </Button>
        </div>
      </div>

      {excludedCount > 0 && (
        <div style={s.note}>{t("evals.excludedSkillOwned", { count: excludedCount })}</div>
      )}

      <CaseList
        cases={cases}
        runningCaseId={runningCaseId}
        runDisabled={runBatch.isPending}
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
          disabled={clearHistory.isPending || (batches ?? []).length === 0}
        >
          {t("evals.history.clearHistory")}
        </Button>
      </div>
      <BatchHistoryTable agentId={agent.id} batches={batches ?? []} highlightBatchId={highlightedBatchId} />

      <div style={s.sectionLabel}>{t("evals.trend.title")}</div>
      <KpiDeltaStrip delta={kpiDelta} isLoading={loadingKpiDelta} />
      <TrendChart points={trendPoints ?? []} onHighlightBatch={setHighlightedBatchId} fillWidth />

      {editorOpen && (
          <CaseEditor
            agentId={agent.id}
            agentName={agent.name}
            initialCase={editingCase}
            onClose={closeEditor}
            onRunCase={runCase}
            runDisabled={runBatch.isPending}
          />
        )}

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
}
