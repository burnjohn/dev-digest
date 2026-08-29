import {
  EvalAblationOutput,
  EvalBatchStatus,
  type EvalBatchComparison,
  type EvalBatchRecord,
  type EvalCaseRecord,
  type EvalCaseRunResult,
  type EvalCaseSource,
  type EvalExpectationKind,
  type EvalExpectedFinding,
  type EvalForbiddenRegion,
  type EvalMetricDelta,
  type EvalOwnerDashboard,
  type EvalOwnerKind,
  type EvalTrendSeriesPoint,
} from '@devdigest/shared';
import type { EvalBatchRow, EvalCaseRow, EvalRunRow } from '../../db/rows.js';

/**
 * Eval dashboard helpers (SPEC-03 "Dashboard, history and comparison" — AC-29,
 * AC-30, AC-32, AC-33, AC-34, AC-37, AC-71). Pure row → DTO mapping and the
 * derived figures; **no I/O**, no `drizzle-orm`, no container, no `fastify`.
 * `EvalBatchRow` (`db/rows.ts`) in, contract DTOs out — the same shape as
 * `modules/repos/helpers.ts::toRepoDto`.
 *
 * `EvalOwnerDashboard` carries no `model` field — AC-29's "that agent's
 * model" is joined from the `agents` table by whichever layer assembles the
 * dashboard response; a pure helper with no DB access cannot resolve it, so
 * it is out of scope here (see `Notes for the integrator` in this task's report).
 */

/** A fall of this size or more (AC-33) triggers the alert banner. */
const ALERT_FALL_THRESHOLD = 0.02;
/** Absorbs float subtraction noise (e.g. `0.5 - 0.48 === 0.020000000000000018`)
 * without loosening the 0.02/0.019 boundary AC-33 requires. */
const EPSILON = 1e-9;

// ===========================================================================
// Row → DTO mapping
// ===========================================================================

/**
 * Maps a persisted `eval_run_batches` row to the wire `EvalBatchRecord`
 * (REQ-29 shaping). `workspace_id` never crosses this boundary — it exists on
 * the row for tenancy scoping only. `cases_passed`/`cases_total` are
 * nullable on the row but required on the contract, so both default to `0`
 * rather than leaking `null` into a `z.number().int()` field. `cases_total`
 * is written at INSERT (the set's size is known when the batch starts), so
 * the `0` fallback now only covers batches created before that — a running
 * batch reports a real denominator.
 */
export function toBatchRecord(row: EvalBatchRow): EvalBatchRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    owner_version: row.ownerVersion,
    runner_agent_id: row.runnerAgentId,
    runner_agent_version: row.runnerAgentVersion,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
    status: EvalBatchStatus.parse(row.status),
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    cases_passed: row.casesPassed ?? 0,
    cases_total: row.casesTotal ?? 0,
    cost_usd: row.costUsd,
  };
}

// ===========================================================================
// Case/run row -> DTO mapping (FIX-5: moved from `service.ts` — R2 placement,
// same row-in/contract-out shape as `toBatchRecord` above and
// `modules/repos/helpers.ts::toRepoDto`).
// ===========================================================================

export function toEvalCaseRecord(row: EvalCaseRow): EvalCaseRecord {
  return {
    id: row.id,
    owner_kind: row.ownerKind as EvalOwnerKind,
    owner_id: row.ownerId,
    name: row.name,
    expectation_kind: (row.expectationKind ?? 'must_not_flag') as EvalExpectationKind,
    input_diff: row.inputDiff ?? '',
    input_files: (row.inputFiles as EvalCaseSource | null) ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: (row.expectedOutput as EvalExpectedFinding[] | null) ?? [],
    forbidden_regions: (row.forbiddenRegions as EvalForbiddenRegion[] | null) ?? null,
    filename: row.inputFilename ?? null,
    notes: row.notes ?? null,
    seeded_from: row.seededFrom ?? null,
  };
}

export function toEvalCaseRunResult(row: EvalRunRow): EvalCaseRunResult {
  // FIX-1/REQ-64/REQ-67: derived from `row.actualOutput` itself, not from a
  // caller-supplied `owner_kind` — an agent-owned run's `actual_output` is a
  // bare `Finding[]`, which `EvalAblationOutput.safeParse` rejects (it is not
  // the `{with, without}` object shape), so `ablation` is `null` for it
  // without this mapping needing to know the case's owner kind at all. A
  // skill-owned run's `actual_output` IS that shape and parses successfully.
  const ablationParse = EvalAblationOutput.safeParse(row.actualOutput);
  return {
    run_id: row.id,
    case_id: row.caseId,
    ran_at: row.ranAt.toISOString(),
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    actual_output: row.actualOutput,
    ablation: ablationParse.success ? ablationParse.data : null,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

// ===========================================================================
// Terminal-batch ordering (REQ-30)
// ===========================================================================

/**
 * A batch is *terminal* when it is no longer `running` **and** carries a
 * `finished_at` — the two are definitionally linked (AC-30 defines "latest
 * batch" via `finished_at`, so a batch without one cannot participate). A
 * type predicate so every caller downstream gets `finishedAt: Date`, not
 * `Date | null`, without a repeated non-null assertion.
 */
export function isTerminalBatch(row: EvalBatchRow): row is EvalBatchRow & { finishedAt: Date } {
  return row.status !== 'running' && row.finishedAt !== null;
}

/**
 * Descending order: latest `finished_at` first, greatest `id` breaking a tie
 * (AC-30). `id` is the unique, immutable key that makes this ordering total —
 * `finished_at` alone is not (`server/INSIGHTS.md`, 2026-08-17).
 */
function compareTerminalDesc(
  a: EvalBatchRow & { finishedAt: Date },
  b: EvalBatchRow & { finishedAt: Date },
): number {
  const byFinishedAt = b.finishedAt.getTime() - a.finishedAt.getTime();
  if (byFinishedAt !== 0) return byFinishedAt;
  if (a.id === b.id) return 0;
  return a.id > b.id ? -1 : 1;
}

/**
 * REQ-30 — the single terminal batch with the greatest `finished_at`, `id`
 * breaking a tie. Never derives a figure by averaging across batches; it
 * only ever selects one row.
 */
export function pickLatestTerminalBatch(rows: readonly EvalBatchRow[]): EvalBatchRow | null {
  const terminal = rows.filter(isTerminalBatch).sort(compareTerminalDesc);
  return terminal[0] ?? null;
}

/**
 * The terminal batch immediately preceding `latest` in the same descending
 * order (REQ-32's comparison target). `null` when `latest` has no
 * predecessor — never falls back to averaging or to an unrelated batch.
 */
export function pickPrecedingTerminalBatch(
  rows: readonly EvalBatchRow[],
  latest: EvalBatchRow,
): EvalBatchRow | null {
  const terminal = rows.filter(isTerminalBatch).sort(compareTerminalDesc);
  const idx = terminal.findIndex((row) => row.id === latest.id);
  if (idx === -1) return null;
  return terminal[idx + 1] ?? null;
}

// ===========================================================================
// REQ-71 — null is uncomparable, never a value
// ===========================================================================

/**
 * One metric's `{old, new, delta}` card (AC-34's compare modal). `delta` is
 * `null` whenever either input is `null` (REQ-71) — a measurement appearing
 * or disappearing between two batches is never rendered as a rise or a fall.
 */
function metricDelta(oldValue: number | null, newValue: number | null): EvalMetricDelta {
  return {
    old: oldValue,
    new: newValue,
    delta: oldValue === null || newValue === null ? null : newValue - oldValue,
  };
}

// ===========================================================================
// REQ-32 — drill-in deltas against the immediately preceding terminal batch
// ===========================================================================

/**
 * REQ-32 — each metric's delta against `preceding`. `—` (rendered as `null`
 * here; the client owns the glyph) when there is no `latest` batch, no
 * `preceding` batch, or either side's metric is `null` (REQ-71) — never a
 * signed zero.
 */
export function buildDashboardDelta(
  latest: EvalBatchRow | null,
  preceding: EvalBatchRow | null,
): EvalOwnerDashboard['delta'] {
  if (!latest || !preceding) {
    return { recall: null, precision: null, citation_accuracy: null };
  }
  return {
    recall: metricDelta(preceding.recall, latest.recall).delta,
    precision: metricDelta(preceding.precision, latest.precision).delta,
    citation_accuracy: metricDelta(preceding.citationAccuracy, latest.citationAccuracy).delta,
  };
}

// ===========================================================================
// REQ-33 — the alert banner, a pure function with no model call
// ===========================================================================

interface FallingMetric {
  label: string;
  fall: number;
}

/**
 * REQ-33 — emits a banner IFF at least one of `recall`, `precision` or
 * `citation_accuracy` fell by `ALERT_FALL_THRESHOLD` (0.02) or more between
 * `preceding` and `latest`, naming the metric, the fall and the batch's
 * `owner_version`. A metric `null` on either side is uncomparable (REQ-71)
 * and is excluded from consideration entirely — it can neither trigger nor
 * suppress the banner on its own. When more than one metric qualifies, the
 * one with the largest fall is named (the worst regression is the one worth
 * surfacing first). Wording is deliberately generic — never the mockup's
 * inferred "a new false positive slipped in", which no deterministic
 * function can conclude from numbers alone.
 */
export function buildAlertBanner(
  latest: EvalBatchRow | null,
  preceding: EvalBatchRow | null,
): string | null {
  if (!latest || !preceding) return null;

  const pairs: Array<{ label: string; oldValue: number | null; newValue: number | null }> = [
    { label: 'Recall', oldValue: preceding.recall, newValue: latest.recall },
    { label: 'Precision', oldValue: preceding.precision, newValue: latest.precision },
    {
      label: 'Citation accuracy',
      oldValue: preceding.citationAccuracy,
      newValue: latest.citationAccuracy,
    },
  ];

  const falling: FallingMetric[] = [];
  for (const { label, oldValue, newValue } of pairs) {
    if (oldValue === null || newValue === null) continue; // REQ-71: uncomparable, no alert
    const fall = oldValue - newValue;
    if (fall >= ALERT_FALL_THRESHOLD - EPSILON) {
      falling.push({ label, fall });
    }
  }

  if (falling.length === 0) return null;
  const worst = falling.reduce((a, b) => (b.fall > a.fall ? b : a));
  return `${worst.label} fell by ${worst.fall.toFixed(2)} on agent version ${latest.ownerVersion}`;
}

// ===========================================================================
// REQ-37 — trend series shaping
// ===========================================================================

/**
 * REQ-37 — one point per metric per row it is handed, in the order given
 * (three named series — Recall, Precision, Citation — flattened into one
 * array via each point's own `metric` field, matching `EvalOwnerDashboard.trend`).
 * A `null` metric value stays `null` in its point rather than becoming `0` or
 * being dropped. An empty `rows` input yields `[]` — three empty series, never
 * `undefined`. Rows without a `finished_at` (a `running` batch) are skipped:
 * `EvalTrendSeriesPoint.finished_at` is a required wire string, so a batch
 * that has not finished has nothing to plot yet; that is a missing row, not a
 * dropped point within a row that IS plotted.
 */
export function buildTrendSeries(rows: readonly EvalBatchRow[]): EvalTrendSeriesPoint[] {
  const points: EvalTrendSeriesPoint[] = [];
  for (const row of rows) {
    if (!isTerminalBatch(row)) continue;
    const finishedAt = row.finishedAt.toISOString();
    points.push({ metric: 'recall', batch_id: row.id, finished_at: finishedAt, value: row.recall });
    points.push({
      metric: 'precision',
      batch_id: row.id,
      finished_at: finishedAt,
      value: row.precision,
    });
    points.push({
      metric: 'citation_accuracy',
      batch_id: row.id,
      finished_at: finishedAt,
      value: row.citationAccuracy,
    });
  }
  return points;
}

// ===========================================================================
// REQ-34 — two-batch comparison shaping (metric cards only)
// ===========================================================================

/**
 * REQ-34 shaping — the four metric delta cards (`recall`, `precision`,
 * `citation_accuracy`, `cost_usd`) plus the two batches' own DTOs, for the
 * compare modal. Deliberately omits `same_version`/`prompt_diff`
 * (`EvalBatchComparison`'s other two fields, REQ-35/REQ-36) — those need the
 * two versions' authored prompt text, which is fetched elsewhere; the caller
 * merges this with `comparePromptVersions` (`prompt-diff.ts`) to build the
 * full `EvalBatchComparison`.
 */
export function buildComparisonMetrics(
  older: EvalBatchRow,
  newer: EvalBatchRow,
): Pick<EvalBatchComparison, 'older' | 'newer' | 'recall' | 'precision' | 'citation_accuracy' | 'cost_usd'> {
  return {
    older: toBatchRecord(older),
    newer: toBatchRecord(newer),
    recall: metricDelta(older.recall, newer.recall),
    precision: metricDelta(older.precision, newer.precision),
    citation_accuracy: metricDelta(older.citationAccuracy, newer.citationAccuracy),
    cost_usd: metricDelta(older.costUsd, newer.costUsd),
  };
}

// ===========================================================================
// REQ-29 shaping — the per-owner dashboard row (minus `model`, see header)
// ===========================================================================

export interface OwnerDashboardInput {
  ownerKind: EvalOwnerKind;
  ownerId: string;
  casesTotal: number;
  /** Every batch for this owner in the relevant window (terminal or
   * `running`) — `latest_batch`, `delta`, `alert` and `trend` are all
   * derived from this set by the functions above. */
  batches: readonly EvalBatchRow[];
  /** The batch history list, already ordered per AC-31 (`started_at` desc,
   * `id` desc) — that ordering is a repository-query concern, not this
   * module's; this function only maps each row to its DTO. */
  recentBatches: readonly EvalBatchRow[];
}

/**
 * REQ-29 shaping — assembles `EvalOwnerDashboard` (minus `model`, which is
 * joined from the `agents` table by the caller). No `workspace_id` reaches
 * this shape: `toBatchRecord` never carries it, and `owner_kind`/`owner_id`
 * here come from the caller's own identifiers, not a row.
 */
export function buildOwnerDashboard(input: OwnerDashboardInput): EvalOwnerDashboard {
  const latest = pickLatestTerminalBatch(input.batches);
  const preceding = latest ? pickPrecedingTerminalBatch(input.batches, latest) : null;
  return {
    owner_kind: input.ownerKind,
    owner_id: input.ownerId,
    cases_total: input.casesTotal,
    latest_batch: latest ? toBatchRecord(latest) : null,
    delta: buildDashboardDelta(latest, preceding),
    trend: buildTrendSeries(input.batches),
    recent_batches: input.recentBatches.map(toBatchRecord),
    alert: buildAlertBanner(latest, preceding),
  };
}
