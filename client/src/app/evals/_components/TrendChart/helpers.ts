/* TrendChart/helpers.ts — turns the server's flat `EvalTrendSeriesPoint[]`
   (one entry per metric per terminal batch, REQ-37) into the per-metric,
   per-batch-aligned arrays `LineChart` wants.

   The one rule every function here obeys: a batch that has NO point for a
   given metric, and a point whose `value` is itself `null`, both become
   `null` in the output — NEVER `0`, NEVER filtered out. T3 widened
   `ChartSeries.data` to `(number | null)[]` and wired `connectNulls={false}`
   for exactly this; coercing or dropping a null here would silently undo
   that (REQ-37/REQ-25, and the client/INSIGHTS.md 2026-08-25 "isError never
   sees a bad payload" lesson applies just as much to a bad TRANSFORM). */
import type { EvalTrendMetric, EvalTrendSeriesPoint } from "@devdigest/shared";

export interface TrendBatchPoint {
  batchId: string;
  finishedAt: string;
}

/** Distinct batches referenced by `trend`, oldest first — the chart's x-axis.
    A batch appears once even though it contributes up to three points (one
    per metric). */
export function orderedTrendBatches(trend: EvalTrendSeriesPoint[]): TrendBatchPoint[] {
  const finishedAtByBatch = new Map<string, string>();
  for (const point of trend) {
    if (!finishedAtByBatch.has(point.batch_id)) {
      finishedAtByBatch.set(point.batch_id, point.finished_at);
    }
  }
  return Array.from(finishedAtByBatch, ([batchId, finishedAt]) => ({ batchId, finishedAt })).sort(
    (a, b) => a.finishedAt.localeCompare(b.finishedAt),
  );
}

/** One metric's values, aligned index-for-index to `batches`. `.has()` before
    `.get()` so a point whose OWN `value` is `null` (measured-but-absent) and a
    batch with NO point for this metric at all (never measured) both surface
    as `null` here — the two cases the caller must not need to tell apart. */
export function trendSeriesFor(
  trend: EvalTrendSeriesPoint[],
  metric: EvalTrendMetric,
  batches: TrendBatchPoint[],
): (number | null)[] {
  const valueByBatch = new Map<string, number | null>();
  for (const point of trend) {
    if (point.metric === metric) valueByBatch.set(point.batch_id, point.value);
  }
  return batches.map((b) => (valueByBatch.has(b.batchId) ? valueByBatch.get(b.batchId)! : null));
}
