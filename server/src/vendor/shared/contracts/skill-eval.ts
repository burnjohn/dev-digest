import { z } from 'zod';

/**
 * Skill Eval — case, batch, judge verdict, and run-request contracts (L06+).
 *
 * ADDITIVE ONLY. Sibling capability to `contracts/eval-batch.ts` (agent-eval,
 * L06 — recall/precision/citation-accuracy). This file is untouched by, and
 * does not touch, that one. The two pipelines share table infrastructure
 * patterns (`eval_cases`, a batch table, a 202+poll run flow) but use
 * entirely different scoring methodologies and route surfaces
 * (`/agents/:id/evals/*` vs `/skills/:id/evals/*`). Do NOT import/reuse any
 * type from `eval-batch.ts` here — the two features' contracts stay fully
 * independent even where field shapes coincide (e.g. `EvalCaseSource` vs
 * `SkillEvalCaseSource`, identical values, deliberately separate types).
 *
 * Scoring vocabulary note: `grounding: string[]` here is a deterministic
 * substring-presence gate (scored by a function named `patternMatch()`,
 * never `groundFindings()`) and is UNRELATED to `reviewer-core`'s mandatory
 * citation gate `groundFindings()`, which remains untouched and out of
 * scope for this feature. See docs/plans/2026-07-06-skill-eval-pipeline.md
 * §4 Constraints for the full naming-collision note.
 */

// ===========================================================================
// Skill Eval Case — source, list item, create input
// ===========================================================================

/** Where a skill eval case originated from — a promoted finding, or
 *  hand-authored. A SEPARATE type from `eval-batch.ts`'s `EvalCaseSource` —
 *  do NOT import/reuse `EvalCaseSource` here; keep the two features'
 *  contracts fully independent. */
export const SkillEvalCaseSource = z.enum(['finding', 'manual']);
export type SkillEvalCaseSource = z.infer<typeof SkillEvalCaseSource>;

/** A single practice-judge result for one practice statement. Mirrors
 *  `evals/src/scoring/llm-judge.ts`'s `Verdict.results[]` element — field is
 *  `passed`, NOT `pass`, matching the harness's own field name exactly. */
export const PracticeVerdict = z.object({
  practice: z.string(),
  passed: z.boolean(),
  evidence: z.string(),
});
export type PracticeVerdict = z.infer<typeof PracticeVerdict>;

/** Full practices-judge verdict — overall score plus the per-practice
 *  breakdown that produced it. */
export const JudgeVerdict = z.object({
  score: z.number().min(0).max(1),
  results: z.array(PracticeVerdict),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdict>;

/** Row shape for the skill eval case list view. */
export const SkillEvalCaseListItem = z.object({
  id: z.string(),
  skill_id: z.string(),
  name: z.string(),
  source: SkillEvalCaseSource,
  source_finding_id: z.string().nullish(),
  source_pr_number: z.number().int().nullish(),
  fixture: z.string(),
  practices: z.array(z.string()),
  grounding: z.array(z.string()),
  threshold: z.number().min(0).max(1),
  last_run_status: z.enum([
    'never_run',
    'passed',
    'failed_grounding',
    'failed_judge',
    'error',
  ]),
  last_run_summary: z.string().nullish(),
  last_host_agent_id: z.string().nullish(),
});
export type SkillEvalCaseListItem = z.infer<typeof SkillEvalCaseListItem>;

/**
 * Request body for creating a hand-authored skill eval case. The AC-2
 * cross-field rule (at least one of `practices`/`grounding` non-empty) and
 * AC-3 (non-empty `fixture`) are validated at the SERVICE layer, NOT here as
 * a Zod refinement.
 */
export const SkillEvalCaseCreateInput = z.object({
  skill_id: z.string(),
  name: z.string().min(1),
  fixture: z.string(),
  practices: z.array(z.string()).default([]),
  grounding: z.array(z.string()).default([]),
  threshold: z.number().min(0).max(1).default(0.6),
  notes: z.string().nullish(),
});
export type SkillEvalCaseCreateInput = z.infer<typeof SkillEvalCaseCreateInput>;

// ===========================================================================
// Skill Eval Batch — a run of many cases together, plus per-case outcomes
// ===========================================================================

/** `full` = every case for the skill; `calibration` = an explicit subset. */
export const SkillEvalBatchKind = z.enum(['full', 'calibration']);
export type SkillEvalBatchKind = z.infer<typeof SkillEvalBatchKind>;

/** `degraded` when any case errored. */
export const SkillEvalBatchStatus = z.enum(['clean', 'degraded']);
export type SkillEvalBatchStatus = z.infer<typeof SkillEvalBatchStatus>;

/** A persisted skill eval batch row (aggregate metrics across its member
 *  cases). */
export const SkillEvalBatch = z.object({
  id: z.string(),
  skill_id: z.string(),
  host_agent_id: z.string(),
  kind: SkillEvalBatchKind,
  status: SkillEvalBatchStatus.nullable(),
  snapshot_identity: z.unknown(),
  model: z.string(),
  judge_score: z.number().nullable(),
  grounding_pass_rate: z.number().nullable(),
  cases_passing: z.number().int().nullable(),
  cases_total: z.number().int(),
  cost_usd: z.number().nullable(),
  ran_at: z.string(),
});
export type SkillEvalBatch = z.infer<typeof SkillEvalBatch>;

/** Per-case outcome within a skill eval batch. */
export const SkillEvalBatchCaseOutcome = z.object({
  case_id: z.string(),
  case_name: z.string(),
  status: z.enum(['passed', 'failed_grounding', 'failed_judge', 'error']),
  grounding_missing: z.array(z.string()),
  judge_score: z.number().nullable(),
  judge_evidence: z.array(PracticeVerdict).nullable(),
  cost_usd: z.number().nullable(),
  error_message: z.string().nullish(),
});
export type SkillEvalBatchCaseOutcome = z.infer<typeof SkillEvalBatchCaseOutcome>;

/** Full batch detail — aggregate row + the per-case breakdown. */
export const SkillEvalBatchDetail = SkillEvalBatch.extend({
  cases: z.array(SkillEvalBatchCaseOutcome),
});
export type SkillEvalBatchDetail = z.infer<typeof SkillEvalBatchDetail>;

// ===========================================================================
// Skill Eval Run — request/response contracts
// ===========================================================================

/**
 * Request body for `POST /skills/:id/evals/run`. `host_agent_id` is
 * REQUIRED on every run request — the client pre-fills the default, but the
 * server always receives an explicit id. Omitted/absent `case_ids` → full-set
 * run; present with a strict subset of the skill's cases → calibration batch.
 */
export const SkillEvalRunBatchRequest = z.object({
  case_ids: z.array(z.string().uuid()).min(1).nullish(),
  host_agent_id: z.string().uuid(),
});
export type SkillEvalRunBatchRequest = z.infer<typeof SkillEvalRunBatchRequest>;

/**
 * Response body for `POST /skills/:id/evals/run` (202 Accepted). The client
 * then polls `GET /skills/:id/evals/batches/:batchId` for completion.
 */
export const SkillEvalRunAcceptedResponse = z.object({
  batch_id: z.string().uuid(),
});
export type SkillEvalRunAcceptedResponse = z.infer<
  typeof SkillEvalRunAcceptedResponse
>;

/** `GET /skills/:id/evals` response envelope. */
export const SkillEvalCaseListResponse = z.object({
  cases: z.array(SkillEvalCaseListItem),
});
export type SkillEvalCaseListResponse = z.infer<typeof SkillEvalCaseListResponse>;

// ===========================================================================
// Trend / Compare / KPI-delta / Clear-history — ported from the agent-eval
// pipeline's precedent (contracts/eval-batch.ts's EvalTrendPointV2 /
// EvalBatchCompareResult), reversing this feature's original spec Non-goals
// at the user's explicit request. FROZEN shapes — do not deviate.
// ===========================================================================

/** A single point on the skill-eval trend chart — one 'full'-kind, sealed
 *  batch. Never fabricated for a batch with no real signal (all-null/zero
 *  metrics are filtered out upstream, in the service, before this DTO is
 *  built) — see `SkillEvalService.getTrend`. */
export const SkillEvalTrendPoint = z.object({
  batch_id: z.string(),
  ran_at: z.string(),
  judge_score: z.number(),
  grounding_pass_rate: z.number(),
  cases_passing_rate: z.number(),
  is_degraded: z.boolean(),
  snapshot_identity: z.unknown(),
  cost_usd: z.number().nullable(),
});
export type SkillEvalTrendPoint = z.infer<typeof SkillEvalTrendPoint>;

/** Side-by-side comparison of two skill-eval batches. */
export const SkillEvalBatchCompareResult = z.object({
  a: SkillEvalBatchDetail,
  b: SkillEvalBatchDetail,
  deltas: z.object({
    judge_score: z.number(),
    grounding_pass_rate: z.number(),
    cases_passing_rate: z.number(),
  }),
});
export type SkillEvalBatchCompareResult = z.infer<typeof SkillEvalBatchCompareResult>;

/** KPI delta vs. the previous full batch — `null` (not a fabricated delta)
 *  when there is no baseline or either side has a null/zero-total metric. */
export const SkillEvalKpiDeltaResponse = z
  .object({
    judge_score: z.number(),
    grounding_pass_rate: z.number(),
    cases_passing_rate: z.number(),
  })
  .nullable();
export type SkillEvalKpiDeltaResponse = z.infer<typeof SkillEvalKpiDeltaResponse>;

/** Response for `DELETE /skills/:id/evals/batches` — case definitions are
 *  never touched, only their run history. */
export const SkillEvalClearHistoryResponse = z.object({
  deleted_batches: z.number().int(),
  deleted_runs: z.number().int(),
});
export type SkillEvalClearHistoryResponse = z.infer<typeof SkillEvalClearHistoryResponse>;
