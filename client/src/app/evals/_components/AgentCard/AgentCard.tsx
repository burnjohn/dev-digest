"use client";

/* AgentCard (Eval Dashboard) — one full-width row per eval-configured agent:
   an icon + name/model badge + a "last run · timestamp · pass" meta line on
   the left, the recall sparkline in the middle, and the latest batch's
   recall/precision/citation-accuracy as three colored metric columns on the
   right, ending in a chevron. Degraded batches are called out with a red
   "Degraded" chip beside the name and a red sparkline (AC-6). Clicking the row
   navigates to the agent's detail page (AC-7). */

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Sparkline } from "@devdigest/ui";
import type { EvalAgentSummary } from "@devdigest/shared";
import { pct, modelLabelFrom } from "@/components/eval";
import { s } from "./styles";

/** Pass/total for the agent's latest batch — joined client-side from the
 *  cross-agent recent-runs feed (the `/evals/overview` payload doesn't carry
 *  per-batch pass counts). `null` when the latest batch predates the recent
 *  feed's cap, in which case the card falls back to the case count. */
export interface AgentCardPassInfo {
  pass: number;
  total: number;
}

export function AgentCard({
  summary,
  passInfo,
}: {
  summary: EvalAgentSummary;
  passInfo?: AgentCardPassInfo | null;
}) {
  const t = useTranslations("evals");
  const router = useRouter();
  const { agent_id, agent_name, latest_batch, latest_version, sparkline_points, case_count } = summary;

  const isDegraded = latest_batch?.status === "degraded";
  const model = latest_batch ? modelLabelFrom(latest_batch.agent_snapshot) : summary.model;

  // `latest_version` is the PROMPT version of the latest run ("—" when that
  // run predates prompt tracking, matching the VERSION column convention).
  const meta = latest_batch
    ? passInfo
      ? t("card.lastRunPass", {
          version: latest_version ?? "—",
          timestamp: new Date(latest_batch.ran_at).toLocaleString(),
          pass: passInfo.pass,
          total: passInfo.total,
        })
      : t("card.lastRunCases", {
          version: latest_version ?? "—",
          timestamp: new Date(latest_batch.ran_at).toLocaleString(),
          count: case_count,
        })
    : t("card.noRuns");

  const goToDetail = () => router.push(`/evals/${agent_id}`);

  // The card sparkline is a mini-chart of the last three full-batch recall
  // values (chronological, newest at the right). Fewer than three → whatever
  // exists (2 → short line, 1 → a dot); none → a "—" placeholder.
  const recallSeries = sparkline_points.slice(-3).map((p) => p.recall);

  const metrics = [
    { key: "recall", label: t("card.recall"), value: latest_batch?.recall ?? null, color: "var(--accent)" },
    { key: "precision", label: t("card.precision"), value: latest_batch?.precision ?? null, color: "var(--ok)" },
    { key: "citation", label: t("card.citationAccuracy"), value: latest_batch?.citation_accuracy ?? null, color: "var(--warn)" },
  ];

  return (
    <div style={s.card} onClick={goToDetail} data-testid={`agent-card-${agent_id}`}>
      <div style={s.iconBox}>
        <Icon.Cpu size={16} />
      </div>

      <div style={s.leftText}>
        <div style={s.nameRow}>
          <span style={s.name}>{agent_name}</span>
          <span style={s.modelBadge} title={model}>{model}</span>
          {isDegraded && <span style={s.degradedChip}>{t("card.statusDegraded")}</span>}
        </div>
        <span style={s.meta}>{meta}</span>
      </div>

      {/* Flexible gap pushes the compact sparkline + metrics to the right,
          matching the mockup (the chart is a small fixed-width glyph, not a
          full-width stretch). */}
      <div style={s.spacer} />

      <div style={s.sparklineBox}>
        {recallSeries.length > 0 ? (
          <Sparkline data={recallSeries} color={isDegraded ? "var(--crit)" : "var(--accent)"} w={96} h={34} />
        ) : (
          <span style={s.sparklineEmpty}>—</span>
        )}
      </div>

      <div style={s.metricsGroup}>
        {metrics.map((m) => (
          <div key={m.key} style={s.metricCol}>
            <span style={s.metricLabel}>{m.label}</span>
            <span style={{ ...s.metricValue, color: m.value == null ? "var(--text-muted)" : m.color }}>
              {pct(m.value)}
            </span>
          </div>
        ))}
      </div>

      <Icon.ChevronRight size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
    </div>
  );
}
