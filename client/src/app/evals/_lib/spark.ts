/* _lib/spark.ts — the tiny per-metric trend series both eval views draw.

   `EvalOwnerDashboard.trend` is served by BOTH the list and the drill-in
   endpoints (30 days, one point per metric per terminal batch), so a sparkline
   costs no extra request on either page. Alignment is delegated to
   TrendChart's helpers rather than re-derived: that file exists specifically
   to keep an unmeasured batch `null` instead of `0`. */
import type { EvalTrendMetric, EvalTrendSeriesPoint } from "@devdigest/shared";
import { orderedTrendBatches, trendSeriesFor } from "../_components/TrendChart/helpers";

/** Minimum finite points worth drawing. `vendor/ui`'s `Sparkline` divides by
    `data.length - 1`, so a single point yields `NaN` coordinates and an
    invalid path — and a lone dot would read as a trend it has not measured. */
const MIN_SPARK_POINTS = 2;

/**
 * One metric's trailing-30-day series as the plain `number[]` `Sparkline`
 * takes, or `null` when there is not enough of it to draw.
 *
 * Nulls are DROPPED here rather than preserved as gaps — the opposite of
 * `TrendChart`, deliberately. At 80x24px a gap is indistinguishable from the
 * line simply ending, so an unmeasured batch is better skipped than rendered
 * as an ambiguous break. The full-size chart on the drill-in is where that
 * distinction is legible, and it still keeps it.
 */
export function sparkPointsFor(
  trend: EvalTrendSeriesPoint[],
  metric: EvalTrendMetric,
): number[] | null {
  const batches = orderedTrendBatches(trend);
  const points = trendSeriesFor(trend, metric, batches).filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  return points.length >= MIN_SPARK_POINTS ? points : null;
}
