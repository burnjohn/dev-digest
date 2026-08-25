"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MetricCard, Donut, EmptyState, ErrorState, Skeleton, SelectInput, Badge, Icon } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useAgents, useAgentsStats } from "@/lib/hooks/agents";
import {
  computeDashboardTotals,
  costByAgentSegments,
  costByModelSegments,
  isSmallSample,
  periodRange,
  sortRows,
  type PerformanceRow,
} from "./helpers";
import type { Period, SortDir, SortKey } from "./constants";
import { s } from "./styles";

/**
 * Agent Performance — the global, workspace-wide dashboard (L08 optional
 * homework). Aggregates the SAME persisted `agent_runs`/`findings` the
 * per-agent Stats tab already shows, across ALL agents, for a selectable
 * period. Read-only over already-cached `AgentStats[]` — never triggers a
 * model call, never a second query on sort/expand. `computeAgentStats`
 * (server) stays the ONLY aggregator; this view only derives totals from
 * its already-computed fields (`helpers.ts`).
 */
export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const { data: agents } = useAgents();

  const [period, setPeriod] = React.useState<Period>("30d");
  const [customSince, setCustomSince] = React.useState("");
  const [customUntil, setCustomUntil] = React.useState("");
  const [sortKey, setSortKey] = React.useState<SortKey>("runs");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const range = periodRange(period, customSince, customUntil);
  const agentList = agents ?? [];
  const agentIds = agentList.map((a) => a.id);
  const { data: statsMap, isLoading, isError, refetch } = useAgentsStats(agentIds, range);

  const rows: PerformanceRow[] = agentList.map((agent) => ({ agent, stats: statsMap.get(agent.id) }));
  const sortedRows = sortRows(rows, sortKey, sortDir);

  const statsList = agentList.map((a) => statsMap.get(a.id)).filter((v): v is NonNullable<typeof v> => !!v);
  const totals = computeDashboardTotals(statsList);
  const costByAgent = costByAgentSegments(rows);
  const costByModel = costByModelSegments(rows);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) => (key === sortKey ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <div style={s.page}>
        <div style={s.headerRow}>
          <div>
            <h1 style={s.h1}>{t("title")}</h1>
            <p style={s.subtitle}>{t("subtitle")}</p>
          </div>
        </div>

        <div style={s.periodRow}>
          <div style={s.periodSelect}>
            <SelectInput
              value={period}
              onChange={(v) => setPeriod(v as Period)}
              options={[
                { value: "1d", label: t("period.oneDay") },
                { value: "30d", label: t("period.thirtyDays") },
                { value: "custom", label: t("period.custom") },
              ]}
              mono={false}
            />
          </div>
          {period === "custom" && (
            <>
              <label>
                {t("period.since")}{" "}
                <input
                  type="date"
                  style={s.dateInput}
                  value={customSince}
                  onChange={(e) => setCustomSince(e.target.value)}
                />
              </label>
              <label>
                {t("period.until")}{" "}
                <input
                  type="date"
                  style={s.dateInput}
                  value={customUntil}
                  onChange={(e) => setCustomUntil(e.target.value)}
                />
              </label>
            </>
          )}
        </div>

        {isLoading && <Skeleton height={220} />}
        {!isLoading && isError && <ErrorState body={t("loadError")} onRetry={() => refetch()} />}

        {!isLoading && !isError && agentList.length === 0 && (
          <EmptyState icon="Cpu" title={t("empty.noAgentsTitle")} body={t("empty.noAgentsBody")} />
        )}

        {!isLoading && !isError && agentList.length > 0 && totals.totalRuns === 0 && (
          <EmptyState icon="Gauge" title={t("empty.noRunsInPeriodTitle")} body={t("empty.noRunsInPeriodBody")} />
        )}

        {!isLoading && !isError && agentList.length > 0 && totals.totalRuns > 0 && (
          <>
            <div style={s.tiles}>
              <div>
                <MetricCard label={t("summary.totalRuns")} value={totals.totalRuns} />
                <p style={s.tileFootnote}>{t("summary.basedOnRuns", { count: totals.totalRuns })}</p>
              </div>
              <div>
                <MetricCard
                  label={t("summary.avgAcceptRate")}
                  value={totals.avgAcceptRate != null ? `${Math.round(totals.avgAcceptRate * 100)}%` : "—"}
                />
                {/* Weighted, not an average-of-per-agent-rates — states its own
                    denominator so no aggregate hides how many runs it's built from. */}
                <p style={s.tileFootnote}>
                  {t("summary.decidedOf", {
                    accepted: statsList.reduce((sum, x) => sum + x.accepted, 0),
                    decided: totals.decided,
                  })}
                </p>
              </div>
              <div>
                <MetricCard
                  label={t("summary.totalCost")}
                  value={totals.totalCost != null ? `$${totals.totalCost.toFixed(2)}` : "—"}
                />
                <p style={s.tileFootnote} title={t("estimatedCostTooltip")}>
                  {t("estimatedCost")}
                </p>
              </div>
              <div>
                <MetricCard label={t("summary.mostActive")} value={totals.mostActive ? totals.mostActive.agentName : "—"} />
                <p style={s.tileFootnote}>
                  {totals.mostActive ? t("summary.basedOnRuns", { count: totals.mostActive.runs }) : ""}
                </p>
              </div>
            </div>

            <div style={s.panels}>
              <div style={s.panel}>
                <div style={s.panelTitle}>
                  <Icon.DollarSign size={14} /> {t("costByAgent")}{" "}
                  <span style={s.estimatedBadge} title={t("estimatedCostTooltip")}>
                    ({t("estimatedCost")})
                  </span>
                </div>
                {costByAgent.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("noCost")}</p>
                ) : (
                  <Donut segments={costByAgent} />
                )}
              </div>
              <div style={s.panel}>
                <div style={s.panelTitle}>
                  <Icon.Boxes size={14} /> {t("costByModel")}{" "}
                  <span style={s.estimatedBadge} title={t("estimatedCostTooltip")}>
                    ({t("estimatedCost")})
                  </span>
                </div>
                {costByModel.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("noCost")}</p>
                ) : (
                  <Donut segments={costByModel} />
                )}
              </div>
            </div>

            <div style={s.tablePanel}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th} onClick={() => toggleSort("agent")} role="button">
                      {t("table.agent")}
                      {sortIndicator("agent")}
                    </th>
                    <th style={s.th} onClick={() => toggleSort("runs")} role="button">
                      {t("table.runs")}
                      {sortIndicator("runs")}
                    </th>
                    <th style={s.th} onClick={() => toggleSort("avgCost")} role="button">
                      {t("table.avgCost")} ({t("estimatedCost")})
                      {sortIndicator("avgCost")}
                    </th>
                    <th style={s.th} onClick={() => toggleSort("avgDuration")} role="button">
                      {t("table.avgDuration")}
                      {sortIndicator("avgDuration")}
                    </th>
                    <th style={s.th} onClick={() => toggleSort("acceptRate")} role="button">
                      {t("table.acceptRate")}
                      {sortIndicator("acceptRate")}
                    </th>
                    <th style={s.th} onClick={() => toggleSort("lastRun")} role="button">
                      {t("table.lastRun")}
                      {sortIndicator("lastRun")}
                    </th>
                    <th style={s.th}>{t("table.view")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map(({ agent, stats }) => {
                    const decided = (stats?.accepted ?? 0) + (stats?.dismissed ?? 0);
                    const small = isSmallSample(stats);
                    const lastRun = stats?.run_history[0]?.ran_at;
                    return (
                      <tr key={agent.id}>
                        <td style={s.td}>{agent.name}</td>
                        <td style={s.td}>{stats?.runs ?? "—"}</td>
                        <td style={s.td}>{stats?.avg_cost_usd != null ? `$${stats.avg_cost_usd.toFixed(2)}` : "—"}</td>
                        <td style={s.td}>
                          {stats?.avg_latency_ms != null ? `${(stats.avg_latency_ms / 1000).toFixed(1)}s` : "—"}
                        </td>
                        <td style={s.td}>
                          {stats?.accept_rate != null ? (
                            <>
                              {t("table.acceptRateWithDenominator", {
                                pct: Math.round(stats.accept_rate * 100),
                                accepted: stats.accepted,
                                decided,
                              })}
                              {small && (
                                <>
                                  {" "}
                                  <Badge color="var(--text-muted)">{t("smallSample")}</Badge>
                                </>
                              )}
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td style={s.td}>{lastRun ? new Date(lastRun).toLocaleString() : "—"}</td>
                        <td style={s.td}>
                          <Link href={`/agents/${agent.id}?tab=stats`} style={s.viewLink}>
                            {t("table.view")}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
