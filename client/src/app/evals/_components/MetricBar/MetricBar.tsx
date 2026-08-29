/* MetricBar — one metric as a coloured bar plus its percentage.

   Shared by both runs tables in this route (the drill-in's Run history and
   /evals's cross-agent feed), which is why it sits at `_components/` level
   rather than inside either one.

   The value still goes through `_lib/format.ts`, so a `null` reads "—" — and
   it draws NO fill, because a zero-width fill and a measured 0% would
   otherwise be indistinguishable. */
"use client";

import React from "react";
import { formatPercent } from "../../_lib/format";
import { s } from "./styles";

/** The same CSS var per metric that `TrendChart` assigns its three series, so
    the bars, the trend chart and the metric-card sparklines all agree. */
export const METRIC_COLOR = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;

export type MetricKey = keyof typeof METRIC_COLOR;

export function MetricBar({ value, metric }: { value: number | null; metric: MetricKey }) {
  return (
    <div style={s.inner}>
      <span style={s.track} aria-hidden>
        {value !== null && (
          <span
            style={{
              ...s.fill,
              width: `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`,
              background: METRIC_COLOR[metric],
            }}
          />
        )}
      </span>
      <span className="tnum" style={s.value}>
        {formatPercent(value)}
      </span>
    </div>
  );
}
