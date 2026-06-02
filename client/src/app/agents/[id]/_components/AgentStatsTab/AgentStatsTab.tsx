/* AgentStatsTab — A5 Per-agent Stats tab (default export for the A2 Agent
   Editor "Stats" mount point). Accept-rate is the headline quality signal (§7):
   accept/dismiss rate, findings volume, cost + latency aggregates, severity
   breakdown, and a findings-per-run trend. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  BarRow,
  EmptyState,
  MetricCard,
  SectionLabel,
  Skeleton,
  Sparkline,
} from "@devdigest/ui";
import { useAgentStats } from "../../../../../lib/hooks/stats";
import { MIN_TREND_POINTS, OUTCOMES, SEVERITY_ROWS } from "./constants";
import { acceptRateColor, formatCost, formatLatency, pct, share } from "./helpers";
import { s } from "./styles";

export default function AgentStatsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("runs");
  const { data: stats, isLoading } = useAgentStats(agentId);

  if (isLoading) {
    return (
      <div style={s.loadingStack}>
        <Skeleton height={90} />
        <Skeleton height={160} />
      </div>
    );
  }

  if (!stats || stats.runs === 0) {
    return (
      <div style={s.emptyWrap}>
        <EmptyState icon="BarChart" title={t("stats.empty.title")} body={t("stats.empty.body")} />
      </div>
    );
  }

  const sev = stats.findings_by_severity;
  const sevMax = Math.max(1, sev.CRITICAL, sev.WARNING, sev.SUGGESTION);
  const trend = stats.trend.map((p) => p.value);
  const hasTrend = trend.length > MIN_TREND_POINTS;
  const outcomeValues: Record<string, number> = {
    accepted: stats.accepted,
    dismissed: stats.dismissed,
    pending: stats.pending,
  };

  return (
    <div style={s.root}>
      {/* Headline metrics */}
      <div style={s.metricsRow}>
        <MetricCard
          label={t("stats.metric.acceptRate")}
          value={pct(stats.accept_rate)}
          color={acceptRateColor(stats.accept_rate)}
        />
        <MetricCard label={t("stats.metric.dismissRate")} value={pct(stats.dismiss_rate)} />
        <MetricCard label={t("stats.metric.runs")} value={stats.runs} />
        <MetricCard
          label={t("stats.metric.avgFindingsPerRun")}
          value={stats.avg_findings_per_run == null ? "—" : stats.avg_findings_per_run.toFixed(1)}
          trend={hasTrend ? trend : undefined}
        />
      </div>

      {/* Accept/dismiss/pending breakdown */}
      <section>
        <SectionLabel
          icon="ListChecks"
          right={<Badge color="var(--text-muted)">{t("stats.findingsCount", { count: stats.findings_total })}</Badge>}
        >
          {t("stats.findingOutcomes")}
        </SectionLabel>
        <div style={s.outcomesRow}>
          {OUTCOMES.map((o) => (
            <Outcome
              key={o.key}
              label={t(`stats.outcome.${o.key}`)}
              value={outcomeValues[o.key]!}
              color={o.color}
              total={stats.findings_total}
            />
          ))}
        </div>
      </section>

      {/* Severity volume */}
      <section>
        <SectionLabel icon="AlertOctagon">{t("stats.findingsBySeverity")}</SectionLabel>
        <div style={s.severityWrap}>
          {SEVERITY_ROWS.map((r) => (
            <BarRow
              key={r.key}
              label={t(r.labelKey)}
              value={sev[r.key]}
              max={sevMax}
              color={r.color}
              suffix={String(sev[r.key])}
            />
          ))}
        </div>
      </section>

      {/* Cost + latency */}
      <section>
        <SectionLabel icon="Gauge">{t("stats.costAndLatency")}</SectionLabel>
        <div style={s.costRow}>
          <MetricCard
            label={t("stats.metric.totalCost")}
            value={formatCost(stats.total_cost_usd, 2) ?? t("stats.na")}
          />
          <MetricCard
            label={t("stats.metric.avgCostPerRun")}
            value={formatCost(stats.avg_cost_usd, 3) ?? t("stats.na")}
          />
          <MetricCard
            label={t("stats.metric.avgLatency")}
            value={formatLatency(stats.avg_latency_ms) ?? "—"}
          />
          <div style={s.trendCard}>
            <div style={s.trendLabel}>{t("stats.findingsTrend")}</div>
            {hasTrend ? (
              <Sparkline data={trend} />
            ) : (
              <span style={s.trendEmpty}>{t("stats.moreRunsNeeded")}</span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Outcome({ label, value, color, total }: { label: string; value: number; color: string; total: number }) {
  const t = useTranslations("runs");
  return (
    <div style={s.outcome}>
      <span style={s.outcomeDot(color)} />
      <span style={s.outcomeLabel}>{label}</span>
      <span className="tnum" style={s.outcomeValue}>
        {value}
      </span>
      <span style={s.outcomeShare}>{t("stats.sharePct", { pct: share(value, total) })}</span>
    </div>
  );
}
