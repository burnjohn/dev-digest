"use client";

/* EvalDetailView — per-agent Eval Dashboard detail page (`/evals/[agentId]`,
   AC-14). Composes the shared per-agent Evals-tab sub-components (TrendChart,
   BatchHistoryTable) plus dashboard-only pieces: a back link to the landing
   page, an agent-switcher, a "Run eval" trigger (AC-17), a KPI-change banner
   (AC-15), and three KPI cards (recall/precision/citation) each with a
   per-metric sparkline and a delta vs. the previous full batch.

   Data fetching: hooks that already exist — `useAgent`, `useEvalBatchHistory`,
   `useEvalTrend`, `useEvalKpiDelta`, `useEvalOverview` (feeds the switcher's
   list), plus `useRunEvalBatch` + `useEvalRunCompletion` for the "Run eval"
   button (same run mechanism the per-agent Evals tab uses — AC-17). */

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, MetricCard, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgent } from "@/lib/hooks/agents";
import {
  useEvalBatchHistory,
  useEvalTrend,
  useEvalKpiDelta,
  useEvalOverview,
  useEvalRecentAcrossAgents,
  useRunEvalBatch,
  useEvalRunCompletion,
} from "@/lib/hooks/eval";
import { TrendChart, BatchHistoryTable, promptVersionMap } from "@/components/eval";
import { AgentSwitcher } from "../AgentSwitcher/AgentSwitcher";
import { KpiBanner } from "../KpiBanner/KpiBanner";
import { s } from "./styles";

export function EvalDetailView({
  agentId,
  preselectBatchId,
}: {
  agentId: string;
  preselectBatchId: string | null;
}) {
  const t = useTranslations("evals");

  const { data: agent, isLoading: loadingAgent, isError: agentError, error, refetch } = useAgent(agentId);
  const { data: batches, isLoading: loadingBatches } = useEvalBatchHistory(agentId);
  const { data: trendPoints, isLoading: loadingTrend } = useEvalTrend(agentId);
  const { data: kpiDelta, isLoading: loadingKpiDelta } = useEvalKpiDelta(agentId);
  const { data: overview } = useEvalOverview();
  const { data: recent } = useEvalRecentAcrossAgents();

  // Pass/total per batch for the Recent Runs table's PASS column — joined from
  // the cross-agent recent feed (which already computes it) and filtered to
  // this agent; batches older than the feed's cap fall back to "—".
  const passByBatchId = React.useMemo(() => {
    const m = new Map<string, { pass: number; total: number }>();
    for (const r of recent ?? []) {
      if (r.agent_id === agentId) m.set(r.batch.id, { pass: r.pass_count, total: r.total_count });
    }
    return m;
  }, [recent, agentId]);

  // "Run eval" — same full-set run mechanism as the per-agent Evals tab
  // (AC-17). The mutation returns a 202 `{ batch_id }`; `useEvalRunCompletion`
  // then polls that batch to completion and invalidates the dependent queries,
  // at which point we clear the pending id to stop the button's loading state.
  // Batch id hovered on the trend chart — highlights + scrolls the matching
  // Recent-Runs row (chart ⇄ table link, same as the per-agent Evals tab).
  const [highlightedBatchId, setHighlightedBatchId] = React.useState<string | null>(null);

  const runBatch = useRunEvalBatch(agentId);
  const [pendingBatchId, setPendingBatchId] = React.useState<string | null>(null);
  const pendingBatch = useEvalRunCompletion(agentId, pendingBatchId);
  React.useEffect(() => {
    if (pendingBatchId && pendingBatch.data && pendingBatch.data.status != null) setPendingBatchId(null);
  }, [pendingBatchId, pendingBatch.data]);
  const runEval = () => runBatch.mutate({}, { onSuccess: (d) => setPendingBatchId(d.batch_id) });
  const running = runBatch.isPending || pendingBatchId != null;

  const crumb = [{ label: t("landing.breadcrumb"), href: "/evals" }, { label: agent?.name ?? t("detail.breadcrumb") }];

  const isLoading = loadingAgent || loadingBatches || loadingTrend || loadingKpiDelta;

  if (agentError) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <ErrorState
            fullScreen
            title={t("detail.loadError.title")}
            body={error instanceof Error ? error.message : t("detail.loadError.body")}
            onRetry={() => refetch()}
          />
        </div>
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <Skeleton height={24} width={240} style={{ marginBottom: 16 }} />
          <Skeleton height={140} style={{ marginBottom: 16 }} />
          <Skeleton height={220} />
        </div>
      </AppShell>
    );
  }

  if (!agent) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <EmptyState icon="FlaskConical" title={t("detail.notFound.title")} body={t("detail.notFound.body")} />
        </div>
      </AppShell>
    );
  }

  const batchList = batches ?? [];
  const trend = trendPoints ?? [];
  const latestPoint = trend.length ? trend[trend.length - 1]! : null;
  // Run count is over FULL batches only (calibration runs are hidden from the
  // dashboard). The version shown per run is the PROMPT version — it bumps only
  // when the agent's system-prompt text changes, so repeated runs on the same
  // prompt share one vN, and runs predating prompt tracking render as "—".
  const fullBatches = batchList.filter((b) => b.kind === "full");
  const runCount = fullBatches.length;
  const versionByBatchId = promptVersionMap(batchList);
  const overviewAgents = overview ?? [];
  const caseCount = overviewAgents.find((a) => a.agent_id === agentId)?.case_count ?? null;

  const kpiCards = [
    { key: "recall", label: t("detail.banner.metric.recall"), value: latestPoint?.recall ?? null, color: "var(--accent)", trend: trend.map((p) => p.recall), delta: kpiDelta?.recall },
    { key: "precision", label: t("detail.banner.metric.precision"), value: latestPoint?.precision ?? null, color: "var(--ok)", trend: trend.map((p) => p.precision), delta: kpiDelta?.precision },
    { key: "citation", label: t("detail.banner.metric.citation_accuracy"), value: latestPoint?.citation_accuracy ?? null, color: "var(--warn)", trend: trend.map((p) => p.citation_accuracy), delta: kpiDelta?.citation_accuracy },
  ];

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        <Link href="/evals" style={s.backLink}>
          <Icon.ChevronLeft size={15} />
          {t("detail.backToAgents")}
        </Link>

        <div style={s.header}>
          <div style={s.headerText}>
            <div style={s.titleRow}>
              <h1 style={s.h1}>{agent.name}</h1>
              <span style={s.modelBadge} title={agent.model}>{agent.model}</span>
            </div>
            <p style={s.subtitle}>{t("detail.subtitle", { runs: runCount, cases: caseCount ?? 0 })}</p>
          </div>
          <div style={s.headerActions}>
            <AgentSwitcher agentId={agentId} agents={overviewAgents} />
            <Button kind="primary" size="sm" icon="Play" onClick={runEval} loading={running} disabled={running}>
              {t("detail.runEval")}
            </Button>
          </div>
        </div>

        <KpiBanner delta={kpiDelta} />

        <div style={s.kpiRow}>
          {kpiCards.map((c) => (
            <MetricCard
              key={c.key}
              label={c.label}
              value={c.value == null ? "—" : Math.round(c.value * 100)}
              suffix={c.value == null ? undefined : "%"}
              color={c.color}
              trend={c.trend}
              delta={kpiDelta ? c.delta : undefined}
            />
          ))}
        </div>

        <div style={s.trendCard}>
          <div style={s.trendHeader}>
            <Icon.TrendingUp size={13} />
            {t("detail.trendTitle")}
          </div>
          <TrendChart
            points={trend}
            versionByBatchId={versionByBatchId}
            fillWidth
            onHighlightBatch={setHighlightedBatchId}
          />
        </div>

        <div style={s.historySection}>
          <BatchHistoryTable
            agentId={agentId}
            batches={batchList}
            preselectBatchId={preselectBatchId ?? undefined}
            highlightBatchId={highlightedBatchId}
            useModalCompare
            barMetrics
            passByBatchId={passByBatchId}
            versionByBatchId={versionByBatchId}
            headerTitle={t("detail.historyTitle")}
          />
        </div>
      </div>
    </AppShell>
  );
}
