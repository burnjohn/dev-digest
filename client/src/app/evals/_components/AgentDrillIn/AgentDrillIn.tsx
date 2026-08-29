/* AgentDrillIn — /evals/:agentId. Alert banner, three metric cards with
   signed deltas, the 30-day trend chart, and the runs table with per-row
   checkboxes + Compare (REQ-32/33/34/35/36/37/71).

   Mockup licence (docs/mockups/Eval Pipeline 3.png, 4.png) is deliberately
   NOT reproduced: no second agent selector, no dropdown on a "30 days"
   picker (the window is fixed at 30 days server-side, REQ-37 — there is
   nothing to pick), no `Run eval` control (rendering only, per this task's
   `Implements` line), no `Promote v7` footer button in the modal. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox, ErrorState, Icon, SectionLabel, Skeleton, Sparkline } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { ErrorBoundary } from "@/components/error-boundary";
import { useAgent } from "@/lib/hooks/agents";
import { useEvalOwnerDashboard } from "@/lib/hooks/evals";
import type { EvalBatchRecord, EvalTrendMetric, EvalTrendSeriesPoint } from "@devdigest/shared";
import { METRIC_COLOR, MetricBar, type MetricKey } from "../MetricBar";
import { TrendChart } from "../TrendChart";
import { CompareModal } from "../CompareModal";
import {
  formatBatchTimestamp,
  formatCost,
  formatPassRatio,
  formatPercent,
  formatSignedPercentDelta,
} from "../../_lib/format";
import { sparkPointsFor } from "../../_lib/spark";
import { s } from "./styles";

/** `MetricKey` labels the UI column; the wire name for citation is
    `citation_accuracy`. One map, so no call site has to remember that. */
const TREND_METRIC: Record<MetricKey, EvalTrendMetric> = {
  recall: "recall",
  precision: "precision",
  citation: "citation_accuracy",
};

function MetricCard({
  label,
  value,
  delta,
  metric,
  trend,
}: {
  label: string;
  value: number | null;
  delta: number | null;
  metric: MetricKey;
  trend: EvalTrendSeriesPoint[];
}) {
  const deltaColor =
    delta === null || delta === 0
      ? "var(--text-muted)"
      : delta > 0
        ? "var(--ok)"
        : "var(--crit)";
  const spark = sparkPointsFor(trend, TREND_METRIC[metric]);
  return (
    <div style={s.metricCard}>
      <div style={s.metricHead}>
        <span style={s.metricLabel}>{label}</span>
        {/* Decorative: the number below states the value and the full trend
            chart states the history. Null when the window is too short to
            draw a line — see `_lib/spark.ts`. */}
        {spark && (
          <span style={s.metricSpark} aria-hidden>
            <Sparkline data={spark} color={METRIC_COLOR[metric]} w={64} h={22} />
          </span>
        )}
      </div>
      <div style={s.metricRow}>
        <span className="tnum" style={{ ...s.metricValue, color: METRIC_COLOR[metric] }}>
          {formatPercent(value)}
        </span>
        <span className="tnum" style={{ ...s.metricDelta, color: deltaColor }}>
          {formatSignedPercentDelta(delta)}
        </span>
      </div>
    </div>
  );
}

function RunRow({
  batch,
  checked,
  onToggle,
  runLabel,
  versionLabel,
}: {
  batch: EvalBatchRecord;
  checked: boolean;
  onToggle: () => void;
  runLabel: string;
  versionLabel: string;
}) {
  return (
    <tr>
      <td style={s.checkboxCell}>
        <Checkbox
          checked={checked}
          onChange={onToggle}
          ariaLabel={`${runLabel} ${versionLabel} · ${formatBatchTimestamp(batch.started_at)}`}
        />
      </td>
      <td className="tnum" style={{ ...s.td, ...s.dateCell }}>
        {formatBatchTimestamp(batch.started_at)}
      </td>
      <td className="mono" style={{ ...s.td, ...s.versionCell }}>
        {versionLabel}
      </td>
      <td style={s.metricCell}>
        <MetricBar value={batch.recall} metric="recall" />
      </td>
      <td style={s.metricCell}>
        <MetricBar value={batch.precision} metric="precision" />
      </td>
      <td style={s.metricCell}>
        <MetricBar value={batch.citation_accuracy} metric="citation" />
      </td>
      <td className="tnum" style={s.passCell}>
        {formatPassRatio(batch.cases_passed, batch.cases_total)}
      </td>
      <td className="tnum" style={s.td}>
        {formatCost(batch.cost_usd)}
      </td>
    </tr>
  );
}

export function AgentDrillIn({ agentId }: { agentId: string }) {
  const t = useTranslations("eval");
  const tCommon = useTranslations("common");
  const tSkills = useTranslations("skills");

  const { data: agent, isLoading: agentLoading, isError: agentError, refetch: refetchAgent } =
    useAgent(agentId);
  const {
    data: dash,
    isLoading: dashLoading,
    isError: dashError,
    refetch: refetchDash,
  } = useEvalOwnerDashboard(agentId);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [comparing, setComparing] = React.useState(false);

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = Array.from(selected);
  const crumb = [
    { label: t("page.crumbSkillsLab") },
    { label: t("page.crumbEvalDashboard"), href: "/evals" },
    { label: agent?.name ?? "" },
  ];

  if (agentError || dashError || (!agentLoading && !agent)) {
    return (
      <AppShell crumb={crumb}>
        <div style={s.page}>
          <ErrorState
            fullScreen
            body={tCommon("states.error")}
            onRetry={() => {
              refetchAgent();
              refetchDash();
            }}
          />
        </div>
      </AppShell>
    );
  }

  const errorFallback = (reset: () => void) => (
    <ErrorState body={tCommon("states.error")} onRetry={reset} />
  );

  return (
    <AppShell crumb={crumb}>
      <div style={s.page}>
        {agentLoading || dashLoading || !agent || !dash ? (
          <>
            <Skeleton height={28} width={240} />
            <div style={{ marginTop: 18 }}>
              <Skeleton height={200} />
            </div>
          </>
        ) : (
          <>
            <div style={s.header}>
              <div style={s.headerTitle}>
                <h1 style={s.h1}>{agent.name}</h1>
                <Badge color="var(--text-secondary)" mono>
                  {agent.provider}/{agent.model}
                </Badge>
              </div>
              <p style={s.subtitle}>
                {t("dashboard.casesSummary", {
                  count: dash.cases_total,
                  runs: dash.recent_batches.length,
                })}
              </p>
            </div>

            <ErrorBoundary fallback={errorFallback} resetKeys={[agentId]}>
              <>
                {dash.alert && (
                  <div style={s.banner} role="status">
                    <Icon.AlertTriangle size={16} aria-hidden style={{ color: "var(--warn)", flexShrink: 0 }} />
                    <span>{dash.alert}</span>
                  </div>
                )}

                <div style={s.section}>
                  <div style={s.metricGrid}>
                    <MetricCard
                      label={t("dashboard.metrics.recall")}
                      value={dash.latest_batch?.recall ?? null}
                      delta={dash.delta.recall}
                      metric="recall"
                      trend={dash.trend}
                    />
                    <MetricCard
                      label={t("dashboard.metrics.precision")}
                      value={dash.latest_batch?.precision ?? null}
                      delta={dash.delta.precision}
                      metric="precision"
                      trend={dash.trend}
                    />
                    <MetricCard
                      label={t("dashboard.metrics.citationAccuracy")}
                      value={dash.latest_batch?.citation_accuracy ?? null}
                      delta={dash.delta.citation_accuracy}
                      metric="citation"
                      trend={dash.trend}
                    />
                  </div>
                </div>
              </>
            </ErrorBoundary>

            <ErrorBoundary fallback={errorFallback} resetKeys={[agentId]}>
              <div style={s.section}>
                <SectionLabel icon="TrendingUp">{t("dashboard.metricTrend")}</SectionLabel>
                <TrendChart
                  trend={dash.trend}
                  labels={{
                    recall: t("dashboard.legend.recall"),
                    precision: t("dashboard.legend.precision"),
                    citation: t("dashboard.legend.citation"),
                  }}
                  emptyLabel={tCommon("states.empty")}
                />
              </div>
            </ErrorBoundary>

            <ErrorBoundary fallback={errorFallback} resetKeys={[agentId]}>
              <div style={s.section}>
                <SectionLabel
                  icon="History"
                  right={
                    <div style={s.tableToolbar}>
                      {selectedIds.length > 0 && (
                        <span className="tnum" style={s.selectedCount}>
                          {selectedIds.length}/2
                        </span>
                      )}
                      <Button
                        kind="primary"
                        size="sm"
                        disabled={selectedIds.length !== 2}
                        onClick={() => setComparing(true)}
                      >
                        {t("compareModal.trigger")}
                      </Button>
                    </div>
                  }
                >
                  {t("dashboard.recentRuns")}
                </SectionLabel>

                {dash.recent_batches.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</p>
                ) : (
                  <div style={s.tableScroll}>
                    <table style={s.table}>
                      <thead>
                        <tr>
                          <th style={s.th} />
                          <th style={s.th}>{t("dashboard.table.date")}</th>
                          <th style={s.th}>{t("dashboard.table.version")}</th>
                          <th style={s.th}>{t("dashboard.table.recall")}</th>
                          <th style={s.th}>{t("dashboard.table.precision")}</th>
                          <th style={s.th}>{t("dashboard.table.citation")}</th>
                          <th style={s.th}>{t("dashboard.table.pass")}</th>
                          <th style={s.th}>{t("dashboard.table.cost")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dash.recent_batches.map((batch) => (
                          <RunRow
                            key={batch.id}
                            batch={batch}
                            checked={selected.has(batch.id)}
                            onToggle={() => toggleRow(batch.id)}
                            runLabel={tCommon("actions.run")}
                            versionLabel={tSkills("preview.version", { version: batch.owner_version })}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </ErrorBoundary>

            {comparing && selectedIds.length === 2 && (
              <CompareModal
                batchA={selectedIds[0]!}
                batchB={selectedIds[1]!}
                onClose={() => setComparing(false)}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
