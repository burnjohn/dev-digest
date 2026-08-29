/* TrendChart — the drill-in's 30-day metric trend (REQ-37). A thin wrapper
   over the shared `LineChart` (T3): it builds three `ChartSeries` off the
   server's `trend` array and hands them straight through, it does not draw
   its own chart and it does not flatten a `null` into `0` anywhere on the
   way in (see helpers.ts's header — that discipline is the whole point of
   this file existing separately from AgentDrillIn). */
"use client";

import React from "react";
import { LineChart, type ChartSeries } from "@devdigest/ui";
import type { EvalTrendSeriesPoint } from "@devdigest/shared";
import { orderedTrendBatches, trendSeriesFor } from "./helpers";
import { s } from "./styles";

export interface TrendChartLabels {
  recall: string;
  precision: string;
  citation: string;
}

export function TrendChart({
  trend,
  labels,
  emptyLabel,
}: {
  trend: EvalTrendSeriesPoint[];
  labels: TrendChartLabels;
  /** REQ-37: rendered instead of the chart when the trailing-30-day window
      holds no terminal batch at all. */
  emptyLabel: string;
}) {
  const batches = orderedTrendBatches(trend);
  if (batches.length === 0) {
    return <div style={s.empty}>{emptyLabel}</div>;
  }

  // Three distinct dash patterns (recall solid) plus direct labels below — the
  // legend never leans on color alone (REQ-37's "distinguishable without
  // colour").
  const series: ChartSeries[] = [
    { name: labels.recall, color: "var(--accent)", data: trendSeriesFor(trend, "recall", batches) },
    {
      name: labels.precision,
      color: "var(--ok)",
      data: trendSeriesFor(trend, "precision", batches),
      dash: "4 4",
    },
    {
      name: labels.citation,
      color: "var(--warn)",
      data: trendSeriesFor(trend, "citation_accuracy", batches),
      dash: "2 6",
    },
  ];

  return (
    <div>
      <div style={s.legend}>
        {series.map((series_) => (
          <span key={series_.name} style={s.legendItem}>
            <span
              style={{
                ...s.legendSwatch,
                background: series_.dash ? "transparent" : series_.color,
                borderTop: series_.dash ? `2px dashed ${series_.color}` : undefined,
              }}
            />
            {series_.name}
          </span>
        ))}
      </div>
      <LineChart series={series} />
    </div>
  );
}
