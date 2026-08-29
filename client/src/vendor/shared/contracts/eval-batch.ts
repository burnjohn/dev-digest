import { z } from 'zod';
import { Finding, Severity, FindingCategory } from './findings.js';
import { EvalOwnerKind } from './knowledge.js';

/**
 * Eval Pipeline (SPEC-03) — batch-run + skill-ablation contracts.
 *
 * This file EXTENDS the barrel; it does not edit `eval-ci.ts` or `knowledge.ts`.
 * The base `EvalRun`, `EvalCase`, `EvalOwnerKind` stay in `knowledge.ts`; the
 * per-case API shapes (`EvalCaseInput`, `EvalRunRecord`, `EvalDashboard`, …) stay
 * in `eval-ci.ts` unedited — a required field added to any of them would break
 * every fixture that `.parse()`s it while both typechecks stay green
 * (`server/INSIGHTS.md`, 2026-08-22).
 *
 * Every metric field here (`recall`, `precision`, `citation_accuracy`) is
 * `z.number().nullable()` — that nullability is the entire reason this file
 * exists rather than an edit to `eval-ci.ts`: `EvalDashboard`/`EvalRun`/
 * `EvalRunResult` all declare those fields as non-nullable `z.number()`, which
 * cannot serve an unmeasured metric (AC-25 requires `null`, never `0`).
 */

// ===========================================================================
// Expectations + forbidden regions
// ===========================================================================

/**
 * Derived, never authored — the server sets this from `expected_output`
 * emptiness on every write (AC-43) and rejects any client-supplied value.
 */
export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

/**
 * One finding skeleton inside `expected_output` (AC-10). `file` is required for
 * an agent-owned case but may be omitted for a skill-owned one — the server
 * fills it in with the case's synthesized filename (AC-55).
 */
export const EvalExpectedFinding = z.object({
  severity: Severity,
  category: FindingCategory,
  title: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  file: z.string().nullish(),
});
export type EvalExpectedFinding = z.infer<typeof EvalExpectedFinding>;

/** A region a `must_not_flag` case forbids matching against (AC-45/AC-46). */
export const EvalForbiddenRegion = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
});
export type EvalForbiddenRegion = z.infer<typeof EvalForbiddenRegion>;

// ===========================================================================
// Skill-owned case input (authored before/after source, AC-53/AC-57/AC-58)
// ===========================================================================

/**
 * The authored source for a skill-owned case's `Code` tab, plus the synthesized
 * filename (AC-56). `new_file` has one `After` editor (AC-11.png); `modified_file`
 * has both `Before` and `After` (AC-10.png). The server builds the unified diff
 * from this on save (AC-57/AC-58) — this shape never carries a diff itself.
 */
export const EvalCaseSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('new_file'),
    filename: z.string(),
    after: z.string(),
  }),
  z.object({
    kind: z.literal('modified_file'),
    filename: z.string(),
    before: z.string(),
    after: z.string(),
  }),
]);
export type EvalCaseSource = z.infer<typeof EvalCaseSource>;

// ===========================================================================
// Eval case — persisted record, editor draft, narrowed write payload
// ===========================================================================

/**
 * Which finding decision seeded this case (`reviews/eval-draft.ts`), or null
 * for a hand-authored one. PROVENANCE, not scoring: both seeded arms score as
 * `must_not_flag` (red while the agent still reports those lines), and this is
 * the only thing that tells them apart afterwards — the editor labels the
 * banner POSITIVE vs NEGATIVE from it. `expectation_kind` cannot serve: it is
 * `must_not_flag` for both.
 */
export const EvalSeededFrom = z.enum(['accepted', 'dismissed']);
export type EvalSeededFrom = z.infer<typeof EvalSeededFrom>;

/**
 * The full eval case as served by the API. Narrows `EvalCase`
 * (`contracts/knowledge.ts`) by typing `expected_output`/`input_files` instead
 * of leaving them `z.unknown()`, and adds the three additive columns this
 * feature introduces on `eval_cases`.
 */
export const EvalCaseRecord = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  /** Response-only — derived server-side, never accepted on write. */
  expectation_kind: EvalExpectationKind,
  input_diff: z.string(),
  /** Skill-owned cases only; null for every agent-owned case. */
  input_files: EvalCaseSource.nullable(),
  input_meta: z.unknown().nullable(),
  expected_output: z.array(EvalExpectedFinding),
  forbidden_regions: z.array(EvalForbiddenRegion).nullable(),
  /** Synthesized filename (AC-56); null for agent-owned cases. */
  filename: z.string().nullable(),
  notes: z.string().nullish(),
  seeded_from: EvalSeededFrom.nullish(),
});
export type EvalCaseRecord = z.infer<typeof EvalCaseRecord>;

/**
 * The pre-filled editor state opened by `Turn into eval case` (AC-4/AC-5) —
 * not persisted until the user saves.
 */
export const EvalCaseDraft = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  expected_output: z.array(EvalExpectedFinding),
  forbidden_regions: z.array(EvalForbiddenRegion).nullable(),
  seeded_from: EvalSeededFrom.nullish(),
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

/**
 * The narrowed create/update payload for an eval case. Deliberately a NEW type
 * rather than an edit to `EvalCaseInput` (`contracts/eval-ci.ts`) — that type's
 * `expected_output: z.unknown()` stays as-is for existing callers, and
 * `expectation_kind` is never accepted here (AC-43: server-derived only).
 */
export const EvalCaseWrite = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().nullish(),
  input_files: EvalCaseSource.nullish(),
  filename: z.string().nullish(),
  expected_output: z.array(EvalExpectedFinding),
  forbidden_regions: z.array(EvalForbiddenRegion).nullish(),
  notes: z.string().nullish(),
  seeded_from: EvalSeededFrom.nullish(),
});
export type EvalCaseWrite = z.infer<typeof EvalCaseWrite>;

// ===========================================================================
// Skill ablation (with/without) — AC-61 through AC-65
// ===========================================================================

/** The with-arm result: skill body included in the prompt (AC-61, AC-62). */
export const EvalAblationWithArm = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  findings: z.array(Finding),
});
export type EvalAblationWithArm = z.infer<typeof EvalAblationWithArm>;

/** The without-arm result when it actually ran (AC-63: recall only, no precision/citation). */
const EvalAblationWithoutMetrics = z.object({
  recall: z.number().nullable(),
  findings: z.array(Finding),
});

/**
 * The without arm's two absence variants (AC-65). A true `discriminatedUnion`
 * here — both branches share the literal `unavailable` key.
 */
export const EvalAblationUnavailable = z.discriminatedUnion('unavailable', [
  z.object({ unavailable: z.literal('not_run') }),
  z.object({ unavailable: z.literal('errored'), reason: z.string().nullish() }),
]);
export type EvalAblationUnavailable = z.infer<typeof EvalAblationUnavailable>;

/**
 * The without arm as a whole: either the metrics object or one of the two
 * unavailable variants (AC-64, AC-65) — REQ-65's two absences distinguishable
 * at the type level, not by convention. A plain `z.union`, not
 * `z.discriminatedUnion`, at this outer level: the metrics branch legitimately
 * carries NO `unavailable` key at all (it persists verbatim as `{recall,
 * findings}`, AC-64), and Zod's `discriminatedUnion` requires the discriminant
 * literal present on every branch.
 */
export const EvalAblationWithoutArm = z.union([EvalAblationWithoutMetrics, EvalAblationUnavailable]);
export type EvalAblationWithoutArm = z.infer<typeof EvalAblationWithoutArm>;

/**
 * The persisted shape of a skill-owned case's `eval_runs.actual_output`
 * (AC-64): `{"with": {...}, "without": {...}}`, no new column added.
 */
export const EvalAblationOutput = z.object({
  with: EvalAblationWithArm,
  without: EvalAblationWithoutArm,
});
export type EvalAblationOutput = z.infer<typeof EvalAblationOutput>;

/** Result of running a single case with-arm-only (AC-50, AC-11's `Run case`). */
export const EvalCaseRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  ran_at: z.string(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  actual_output: z.unknown(),
  /** Present only for a skill-owned case that also ran the without arm. */
  ablation: EvalAblationOutput.nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalCaseRunResult = z.infer<typeof EvalCaseRunResult>;

// ===========================================================================
// Batch — history, detail, comparison
// ===========================================================================

export const EvalBatchStatus = z.enum(['running', 'succeeded', 'partial', 'failed']);
export type EvalBatchStatus = z.infer<typeof EvalBatchStatus>;

/**
 * One `eval_run_batches` row, keyed by owner (not by agent) so one shape serves
 * both owner kinds (AC-29, AC-30). `runner_agent_id`/`runner_agent_version`
 * record which agent supplied the prompt/model for a SKILL batch (AC-68) — null
 * on an agent batch, and null-without-deleting-the-row if that agent is later
 * removed (AC-69).
 */
export const EvalBatchRecord = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  owner_version: z.number().int(),
  runner_agent_id: z.string().nullable(),
  runner_agent_version: z.number().int().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  status: EvalBatchStatus,
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  cases_passed: z.number().int(),
  cases_total: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type EvalBatchRecord = z.infer<typeof EvalBatchRecord>;

/**
 * How many of a batch's cases the server runs at once.
 *
 * Shared because BOTH ends need the same number: `evals/pipeline/batch-runner.ts`
 * sizes its worker pool with it, and the studio's eval list uses it to decide
 * how many of the not-yet-scored cases to render as `Running…` rather than
 * `Queued`. A client that guessed would either under-report live work or claim
 * runs that are not happening.
 *
 * It is a CAP, not a target: the pool never exceeds the number of cases left,
 * and every case still runs exactly once. Raising it multiplies the concurrent
 * LLM calls (and the burst cost / 429 exposure) by the same factor.
 */
export const EVAL_BATCH_CONCURRENCY = 3;

/** One case's outcome inside a batch (AC-17's in-progress listing, AC-67's skill-lift). */
export const EvalBatchCaseResult = z.object({
  case_id: z.string(),
  case_name: z.string(),
  errored: z.boolean(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  /** `recall(with) - recall(without)`; null if either recall is null or without is unavailable. */
  skill_lift: z.number().nullable(),
});
export type EvalBatchCaseResult = z.infer<typeof EvalBatchCaseResult>;

/** A batch plus its per-case results (AC-17: served while still `"running"`). */
export const EvalBatchDetail = EvalBatchRecord.extend({
  cases: z.array(EvalBatchCaseResult),
});
export type EvalBatchDetail = z.infer<typeof EvalBatchDetail>;

/** One line of the comparison modal's system-prompt/body diff (AC-35). */
export const EvalPromptDiffLine = z.object({
  op: z.enum(['same', 'add', 'del']),
  text: z.string(),
});
export type EvalPromptDiffLine = z.infer<typeof EvalPromptDiffLine>;

/** One of the four delta cards in the compare modal (AC-34). */
export const EvalMetricDelta = z.object({
  old: z.number().nullable(),
  new: z.number().nullable(),
  delta: z.number().nullable(),
});
export type EvalMetricDelta = z.infer<typeof EvalMetricDelta>;

/** The compare-modal response for two selected batches (AC-34, AC-35, AC-36). */
export const EvalBatchComparison = z.object({
  older: EvalBatchRecord,
  newer: EvalBatchRecord,
  recall: EvalMetricDelta,
  precision: EvalMetricDelta,
  citation_accuracy: EvalMetricDelta,
  cost_usd: EvalMetricDelta,
  /** True IFF both batches share `owner_version` — AC-36's "same version" case. */
  same_version: z.boolean(),
  /** Null when `same_version` — AC-36 renders a statement instead of an empty diff. */
  prompt_diff: z.array(EvalPromptDiffLine).nullable(),
});
export type EvalBatchComparison = z.infer<typeof EvalBatchComparison>;

// ===========================================================================
// Dashboard — per-owner drill-in, also the row shape of the all-owners list
// ===========================================================================

export const EvalTrendMetric = z.enum(['recall', 'precision', 'citation_accuracy']);
export type EvalTrendMetric = z.infer<typeof EvalTrendMetric>;

/** One point of the trailing-30-day metric trend chart (AC-37), one series at a time. */
export const EvalTrendSeriesPoint = z.object({
  metric: EvalTrendMetric,
  batch_id: z.string(),
  finished_at: z.string(),
  value: z.number().nullable(),
});
export type EvalTrendSeriesPoint = z.infer<typeof EvalTrendSeriesPoint>;

/**
 * Per-owner eval dashboard (AC-29's list is `z.array(EvalOwnerDashboard)`; the
 * drill-in of AC-32/AC-33 is one element read in isolation). Replaces
 * `EvalDashboard` (`contracts/eval-ci.ts`) for every endpoint this feature
 * adds — that type's non-nullable metric fields cannot serve AC-25's `null`.
 */
export const EvalOwnerDashboard = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  cases_total: z.number().int(),
  /** AC-30: the single terminal batch with the greatest `finished_at`. */
  latest_batch: EvalBatchRecord.nullable(),
  /** Delta against the immediately preceding terminal batch; null fields IF none exists (AC-32). */
  delta: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
  }),
  trend: z.array(EvalTrendSeriesPoint),
  /** Per-batch history (AC-31 ordering) — the per-batch analogue of `EvalDashboard.recent_runs`. */
  recent_batches: z.array(EvalBatchRecord),
  /** AC-33's alert banner text, or null if no metric fell 0.02+ between the latest two batches. */
  alert: z.string().nullable(),
});
export type EvalOwnerDashboard = z.infer<typeof EvalOwnerDashboard>;
