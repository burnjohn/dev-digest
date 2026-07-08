"use client";

/* TrendChart — one point per full batch, chronological (calibration batches
   already excluded by the trend endpoint, AC-28). The chart is LINKED to the
   Batch History table above rather than carrying its own per-batch list:
   hovering a point reports its batch_id up (onHighlightBatch) so the parent
   highlights + scrolls the matching Batch History row, which already shows the
   run's snapshot / cost / status. Degraded points stay visually distinct via
   the degraded-legend row (AC-30).

   Reuses the existing `LineChart` (Recharts-backed) vendored UI primitive. */

import React from "react";
import { useTranslations } from "next-intl";
import { LineChart, Icon } from "@devdigest/ui";
import type { EvalTrendPointV2 } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { pct, modelLabelFrom } from "../helpers";

export function TrendChart({
  points,
  onHighlightBatch,
  versionByBatchId,
  fillWidth = false,
}: {
  points: EvalTrendPointV2[];
  /** Report the batch_id under the cursor (or null on leave) so a parent can
   *  highlight + scroll the matching Batch History row — the chart links to
   *  that table instead of duplicating its per-batch snapshot/cost details. */
  onHighlightBatch?: (batchId: string | null) => void;
  /** `batchId → PROMPT version` for the tooltip's v-label (dashboard detail
   *  page); absent for runs predating prompt tracking → the label is hidden. */
  versionByBatchId?: Map<string, number>;
  /** Stretch the plotted lines to the full block width + right-align the
   *  legend (dashboard detail page). Default false keeps the Evals-tab look. */
  fillWidth?: boolean;
}) {
  const t = useTranslations("agents");
  // Index of the point under the cursor — drives the per-metric values shown in
  // the legend so they sync with whichever batch you hover (names always show;
  // values only while hovering).
  const [activeIdx, setActiveIdx] = React.useState<number | null>(null);

  if (points.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("evals.trend.empty")}</div>;
  }

  const series = [
    { name: t("evals.history.recall"), color: "var(--accent)", data: points.map((p) => p.recall) },
    { name: t("evals.history.precision"), color: "var(--ok)", data: points.map((p) => p.precision) },
    { name: t("evals.history.citationAccuracy"), color: "var(--warn)", data: points.map((p) => p.citation_accuracy) },
  ];

  const hasDegraded = points.some((p) => p.is_degraded);

  const onActive = (i: number | null) => {
    setActiveIdx(i);
    onHighlightBatch?.(i != null && points[i] ? points[i].batch_id : null);
  };

  return (
    <div>
      {/* Colour legend — names always; each metric's value appears only while a
          point is hovered, and reflects THAT batch (no static clutter). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 10, justifyContent: fillWidth ? "flex-end" : "flex-start" }}>
        {series.map((sr) => (
          <span
            key={sr.name}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-secondary)" }}
          >
            <span aria-hidden style={{ width: 16, borderTop: `2px solid ${sr.color}`, display: "inline-block" }} />
            {sr.name}
            {activeIdx != null && sr.data[activeIdx] != null && (
              <span style={{ color: "var(--text-muted)" }}>{pct(sr.data[activeIdx] ?? null)}</span>
            )}
          </span>
        ))}
      </div>
      <LineChart
        series={series}
        yMin={0}
        yMax={1}
        showDots
        fill={fillWidth}
        onActiveIndexChange={onActive}
        renderTooltip={(i) => {
          const p = points[i];
          if (!p) return null;
          const version = versionByBatchId?.get(p.batch_id) ?? null;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {version != null && <span style={{ fontWeight: 600 }}>v{version}</span>}
              <span style={{ color: "var(--text-muted)" }}>{new Date(p.ran_at).toLocaleString()}</span>
              <span>{modelLabelFrom(p.agent_snapshot)}</span>
              <span>{formatCost(p.cost_usd)}</span>
            </div>
          );
        }}
      />
      {hasDegraded && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, fontSize: 11, color: "var(--crit)" }}>
          <Icon.AlertTriangle size={12} />
          {t("evals.trend.degradedLegend")}
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>{t("evals.trend.linkHint")}</div>
    </div>
  );
}
