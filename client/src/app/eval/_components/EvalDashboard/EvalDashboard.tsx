/* EvalDashboard — A4 Eval Dashboard (ported from ScreenEval in
   screen_skills.jsx). Recall / Precision / Citation metric cards + trend line +
   regression alert banner + recent-runs table. Owner-scoped via props. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  Icon,
  LineChart,
  MetricCard,
  MonoLink,
  SectionLabel,
} from "@devdigest/ui";
import {
  useEvalDashboard,
  useEvalCases,
  useRunAllEvals,
  type EvalCaseFilter,
} from "../../../../lib/hooks/eval";
import { MiniBar } from "./_components/MiniBar";
import { METRIC_COLORS, RUNS_GRID_COLS } from "./constants";
import { toPct } from "./helpers";
import { s } from "./styles";

export function EvalDashboard({
  filter,
  title,
  subtitle,
  onConfigure,
  compact,
}: {
  filter?: EvalCaseFilter;
  title?: string;
  subtitle?: React.ReactNode;
  onConfigure?: () => void;
  compact?: boolean;
}) {
  const t = useTranslations("eval");
  const { data, isLoading } = useEvalDashboard(filter);
  const cases = useEvalCases(filter);
  const runAll = useRunAll(filter);

  const heading = title ?? t("dashboard.defaultTitle");

  if (isLoading) {
    return <div style={s.loading}>{t("dashboard.loading")}</div>;
  }

  const d = data;
  const trend = d?.trend ?? [];
  const recall = trend.map((p) => p.recall);
  const precision = trend.map((p) => p.precision);
  const citation = trend.map((p) => p.citation_accuracy);

  const cur = d?.current;
  const del = d?.delta;

  return (
    <div style={s.page(compact)}>
      <div style={s.header}>
        <div>
          <h1 style={s.h1}>{heading}</h1>
          <p style={s.subtitle}>
            {subtitle ??
              t("dashboard.casesSummary", { count: d?.cases_total ?? 0, runs: trend.length })}
          </p>
        </div>
        <div style={s.headerActions}>
          {onConfigure && <MonoLink onClick={onConfigure}>{t("dashboard.configure")}</MonoLink>}
          {filter?.ownerKind === "agent" && filter.ownerId && (
            <Button kind="primary" size="sm" icon="Play" onClick={() => runAll.run()}>
              {runAll.pending
                ? t("dashboard.running")
                : t("dashboard.runEval", { count: cases.data?.length ?? 0 })}
            </Button>
          )}
        </div>
      </div>

      {d?.alert && (
        <div style={s.alert}>
          <Icon.AlertTriangle size={16} style={s.alertIcon} />
          <span style={s.alertText}>{d.alert}</span>
        </div>
      )}

      <div style={s.metricsRow}>
        <MetricCard
          label={t("dashboard.metrics.recall")}
          value={toPct(cur?.recall)}
          suffix="%"
          delta={del?.recall}
          color={METRIC_COLORS.recall}
          trend={recall}
        />
        <MetricCard
          label={t("dashboard.metrics.precision")}
          value={toPct(cur?.precision)}
          suffix="%"
          delta={del?.precision}
          color={METRIC_COLORS.precision}
          trend={precision}
        />
        <MetricCard
          label={t("dashboard.metrics.citationAccuracy")}
          value={toPct(cur?.citation_accuracy)}
          suffix="%"
          delta={del?.citation_accuracy}
          color={METRIC_COLORS.citation}
          trend={citation}
        />
      </div>

      {trend.length > 1 && (
        <Card style={s.trendCard}>
          <div style={s.trendHead}>
            <SectionLabel icon="TrendingUp">{t("dashboard.metricTrend")}</SectionLabel>
            <div style={s.legend}>
              {([
                [t("dashboard.legend.recall"), METRIC_COLORS.recall],
                [t("dashboard.legend.precision"), METRIC_COLORS.precision],
                [t("dashboard.legend.citation"), METRIC_COLORS.citation],
              ] as const).map(([l, c]) => (
                <span key={l} style={s.legendItem}>
                  <span style={s.legendSwatch(c)} /> {l}
                </span>
              ))}
            </div>
          </div>
          <LineChart
            series={[
              { name: t("dashboard.legend.recall"), data: recall, color: METRIC_COLORS.recall },
              { name: t("dashboard.legend.precision"), data: precision, color: METRIC_COLORS.precision },
              { name: t("dashboard.legend.citation"), data: citation, color: METRIC_COLORS.citation },
            ]}
            w={900}
            h={200}
          />
        </Card>
      )}

      <SectionLabel icon="History">{t("dashboard.recentRuns")}</SectionLabel>
      <div style={s.tableWrap}>
        <div style={s.headRow(RUNS_GRID_COLS)}>
          {[
            t("dashboard.table.ranAt"),
            t("dashboard.table.recall"),
            t("dashboard.table.precision"),
            t("dashboard.table.citation"),
            t("dashboard.table.pass"),
            t("dashboard.table.cost"),
          ].map((c) => (
            <div key={c}>{c}</div>
          ))}
        </div>
        {(d?.recent_runs ?? []).length === 0 ? (
          <div style={s.emptyRuns}>{t("dashboard.noRuns")}</div>
        ) : (
          (d?.recent_runs ?? []).map((r, i, arr) => (
            <div key={r.id} style={s.row(RUNS_GRID_COLS, i === arr.length - 1)}>
              <span className="mono" style={s.ranAt}>
                {new Date(r.ran_at).toLocaleString()}
              </span>
              <MiniBar value={r.recall} color={METRIC_COLORS.recall} />
              <MiniBar value={r.precision} color={METRIC_COLORS.precision} />
              <MiniBar value={r.citation_accuracy} color={METRIC_COLORS.citation} />
              <span className="tnum" style={s.passCell(r.pass)}>
                {r.pass ? t("dashboard.pass") : t("dashboard.fail")}
              </span>
              <span className="mono tnum" style={s.costCell}>
                {r.cost_usd != null ? `$${r.cost_usd.toFixed(2)}` : "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function useRunAll(filter?: EvalCaseFilter) {
  const m = useRunAllEvals();
  return {
    run: () => {
      if (filter?.ownerKind === "agent" && filter.ownerId) m.mutate(filter.ownerId);
    },
    pending: m.isPending,
  };
}

export default EvalDashboard;
