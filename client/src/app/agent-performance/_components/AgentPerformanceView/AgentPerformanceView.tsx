"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Donut,
  MetricCard,
  Sparkline,
  EmptyState,
  ErrorState,
  Skeleton,
  SectionLabel,
} from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useAgentPerformance } from "../../../../lib/hooks/performance";
import { PALETTE, SORT_KEYS, type SortKey } from "./constants";
import { sortAgents, acceptRateColor } from "./helpers";
import { s } from "./styles";

/** Agent Performance page body (route: /agent-performance). */
export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const router = useRouter();
  const params = useSearchParams();
  const sort = (params.get("sort") as SortKey | null) ?? "accept";
  const { data, isLoading, isError, refetch } = useAgentPerformance();

  const setSort = (next: SortKey) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("sort", next);
    router.replace(`/agent-performance?${sp.toString()}`);
  };

  const rows = React.useMemo(() => sortAgents(data?.agents ?? [], sort), [data, sort]);

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <h1 style={s.h1}>{t("title")}</h1>
          <span style={s.subtitle}>{t("subtitle")}</span>
        </div>

        {isLoading && (
          <div style={s.loadingStack}>
            <Skeleton height={84} />
            <Skeleton height={180} />
            <Skeleton height={240} />
          </div>
        )}
        {isError && <ErrorState body={t("loadError")} onRetry={() => refetch()} />}

        {data && !isLoading && (
          <>
            <div style={s.summaryRow}>
              <MetricCard label={t("summary.totalRuns")} value={data.summary.runs} />
              <MetricCard
                label={t("summary.avgAcceptRate")}
                value={data.summary.avg_accept_rate != null ? `${Math.round(data.summary.avg_accept_rate * 100)}%` : "—"}
                color="var(--ok)"
              />
              <MetricCard
                label={t("summary.totalCost")}
                value={data.summary.total_cost_usd != null ? `$${data.summary.total_cost_usd.toFixed(2)}` : "—"}
              />
              <MetricCard label={t("summary.mostActive")} value={data.summary.most_active_agent ?? "—"} />
            </div>

            <div style={s.donutsRow}>
              <div style={s.card}>
                <SectionLabel icon="DollarSign">{t("costByAgent")}</SectionLabel>
                {data.cost_by_agent.length ? (
                  <Donut segments={data.cost_by_agent.map((seg, i) => ({ ...seg, color: PALETTE[i % PALETTE.length]! }))} />
                ) : (
                  <p style={s.muted}>{t("noCost")}</p>
                )}
              </div>
              <div style={s.card}>
                <SectionLabel icon="DollarSign">{t("costByModel")}</SectionLabel>
                {data.cost_by_model.length ? (
                  <Donut segments={data.cost_by_model.map((seg, i) => ({ ...seg, color: PALETTE[i % PALETTE.length]! }))} />
                ) : (
                  <p style={s.muted}>{t("noCost")}</p>
                )}
              </div>
            </div>

            <SectionLabel
              icon="BarChart"
              right={
                <span style={s.sortGroup}>
                  {SORT_KEYS.map((key) => (
                    <button key={key} onClick={() => setSort(key)} style={s.sortBtn(sort === key)}>
                      {key === "accept" ? t("sort.acceptRate") : t(`sort.${key}`)}
                    </button>
                  ))}
                </span>
              }
            >
              {t("perAgent")}
            </SectionLabel>

            {rows.length === 0 ? (
              <EmptyState icon="Activity" title={t("empty.title")} body={t("empty.body")} />
            ) : (
              <div style={s.tableWrap}>
                <div style={{ ...s.headRow, gridTemplateColumns: s.gridCols }}>
                  <span>{t("table.agent")}</span>
                  <span>{t("table.accept")}</span>
                  <span>{t("table.runs")}</span>
                  <span>{t("table.findings")}</span>
                  <span>{t("table.cost")}</span>
                  <span>{t("table.trend")}</span>
                </div>
                {rows.map((r) => (
                  <div key={r.agent_id} style={{ ...s.row, gridTemplateColumns: s.gridCols }}>
                    <span>
                      <span style={s.agentName}>{r.agent_name}</span>
                      <span className="mono" style={s.agentMeta}>
                        {r.provider}/{r.model}
                      </span>
                    </span>
                    <span>
                      {r.accept_rate != null ? (
                        <Badge color={acceptRateColor(r.accept_rate)}>{Math.round(r.accept_rate * 100)}%</Badge>
                      ) : (
                        <span style={s.mutedCell}>—</span>
                      )}
                    </span>
                    <span className="mono tnum">{r.runs}</span>
                    <span className="mono tnum">
                      {r.findings_total}
                      <span style={s.critCount}>{r.findings_by_severity.CRITICAL || ""}</span>
                    </span>
                    <span className="mono tnum">{r.total_cost_usd != null ? `$${r.total_cost_usd.toFixed(2)}` : "—"}</span>
                    <span>{r.trend.length ? <Sparkline data={r.trend} /> : <span style={s.mutedCell}>—</span>}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
