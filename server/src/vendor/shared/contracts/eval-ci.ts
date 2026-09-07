import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import {
  EvalRun,
  EvalOwnerKind,
  EvalExpectation,
  EvalCaseMeta,
  EvalSkillCaseEffect,
  Conformance,
  Provider,
  CiFailOn,
} from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted SUITE run record + dashboard (L06)
// ===========================================================================

/** Create/update payload for an eval case (D16's frozen-input shape; owner
 *  is resolved by the route, never taken from the body — AC-54). */
export const EvalCaseInput = z.object({
  name: z.string().min(1),
  notes: z.string().nullish(),
  input_diff: z.string().min(1),
  input_files: z.array(z.string()),
  input_meta: EvalCaseMeta,
  expectation: EvalExpectation,
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** POST /findings/:id/eval-case request body — the finding id is already the
 *  route param, so nothing is duplicated here besides the confirmation shape
 *  the route needs; kept as a named contract for parity with the others. */
export const EvalCaseFromFindingInput = z.object({
  finding_id: z.string().uuid(),
});
export type EvalCaseFromFindingInput = z.infer<typeof EvalCaseFromFindingInput>;

/**
 * specs/15-skill-eval-cases.md AC-2 — GET /findings/:id/eval-skills' offer
 * list: only skills a run's recorded injected-skill set actually contained,
 * never every skill linked to the finding's agent. `has_case` lets the
 * client grey out an action that would just return the existing case
 * (AC-1's idempotency, made visible before the click, not just handled after).
 */
export const EvalSkillOffer = z.object({
  skill_id: z.string(),
  skill_name: z.string(),
  has_case: z.boolean(),
});
export type EvalSkillOffer = z.infer<typeof EvalSkillOffer>;

/** POST /findings/:id/skill-eval-case request body (R3 — a separate route
 *  from the agent path, never a widened `EvalCaseFromFindingInput`). */
export const EvalSkillCaseFromFindingInput = z.object({
  skill_id: z.string().uuid(),
});
export type EvalSkillCaseFromFindingInput = z.infer<typeof EvalSkillCaseFromFindingInput>;

export const EvalRunStatus = z.enum(['running', 'completed', 'errored']);
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

/**
 * Q1 — a persisted eval SUITE run: one agent against its whole case set
 * (D2). Reshaped from the reserved per-CASE-execution row: `case_id`,
 * `actual_output` and `pass` are gone; `case_ids`/`agent_version`/`metrics`
 * are new. `metrics` is null while `status === 'running'`.
 */
export const EvalRunRecord = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  agent_name: z.string().nullish(),
  status: EvalRunStatus,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  agent_version: z.number().int().nullable(),
  case_ids: z.array(z.string()),
  metrics: EvalRun.nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  error_reason: z.string().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/**
 * specs/15-skill-eval-cases.md D4/AC-19/AC-22 — the with-arm value minus the
 * without-arm value, per metric, over the cases scored in both arms. `null`
 * (never 0) whenever either side is `null` — a lift over a metric that has no
 * denominator in one arm is not applicable, not zero.
 */
export const EvalLift = z.object({
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
});
export type EvalLift = z.infer<typeof EvalLift>;

/**
 * D6/AC-24/AC-52 — a skill-owned run's record. An EXTENSION of
 * `EvalRunRecord` (never a parallel shape), so a skill run is still an
 * `EvalRunRecord` everywhere the base shape is rendered (AC-18) — the base
 * fields (`metrics` etc.) hold the WITH-arm's values by construction (R1).
 * `arm_without` is the full without-arm `EvalRun` (including its own
 * `per_case`) — AC-36's side-by-side view needs the complete finding sets,
 * not just the aggregate metrics.
 */
export const EvalSkillRunRecord = EvalRunRecord.extend({
  skill_version: z.number().int().nullable(),
  carrier_agent_id: z.string().nullable(),
  carrier_agent_name: z.string().nullable(),
  /** D8/AC-52 — true when either enable gate was off for this skill/carrier
   *  at run time, so the with-arm injected a body not currently active in a
   *  real review. Must be shown on every surface presenting this run. */
  gates_bypassed: z.boolean(),
  arm_without: EvalRun.nullable(),
  lift: EvalLift.nullable(),
  effects: z.array(EvalSkillCaseEffect),
  effect_counts: z.object({
    helped: z.number().int(),
    hurt: z.number().int(),
    no_effect_pass: z.number().int(),
    no_effect_fail: z.number().int(),
  }),
});
export type EvalSkillRunRecord = z.infer<typeof EvalSkillRunRecord>;

/** AC-24/AC-25 — stated before any execution starts. */
export const EvalRunEstimate = z.object({
  agents_total: z.number().int(),
  cases_total: z.number().int(),
  executions_total: z.number().int(),
});
export type EvalRunEstimate = z.infer<typeof EvalRunEstimate>;

/**
 * specs/15-skill-eval-cases.md AC-11 — one option in the carrier picker.
 * Carries both gate states so the surface can state the D8 bypass (AC-11/
 * AC-52) without a second round-trip.
 */
export const EvalSkillCarrier = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  skill_enabled: z.boolean(),
  link_enabled: z.boolean(),
});
export type EvalSkillCarrier = z.infer<typeof EvalSkillCarrier>;

/** POST /skills/:id/eval/runs request body (D2/D11 — the carrier is a
 *  required, per-run, recorded parameter, never an implementation detail). */
export const EvalSkillRunInput = z.object({
  carrier_agent_id: z.string().uuid(),
});
export type EvalSkillRunInput = z.infer<typeof EvalSkillRunInput>;

/**
 * AC-11/AC-25 — stated before any execution starts. `executions_total` is
 * `2 × cases_total` (D3's ablation cost), not `cases_total` — the number
 * SPEC-15 is explicit must never be understated.
 */
export const EvalSkillRunEstimate = z.object({
  cases_total: z.number().int(),
  executions_total: z.number().int(),
  carrier_agent_id: z.string(),
  carrier_agent_name: z.string(),
  gates_bypassed: z.boolean(),
});
export type EvalSkillRunEstimate = z.infer<typeof EvalSkillRunEstimate>;

/** Response of `POST /agents/:id/eval/runs` — the start response (Q3: the
 *  client polls `GET /eval/runs/:id` for completion, no SSE). */
export const EvalRunResult = z.object({
  run_id: z.string(),
  status: EvalRunStatus,
  estimate: EvalRunEstimate,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** Response of `POST /eval/runs/all` — AC-25/AC-42: per-agent success or
 *  failure, never one combined verdict. */
export const EvalRunAllResult = z.object({
  estimate: EvalRunEstimate,
  started: z.array(
    z.object({
      agent_id: z.string(),
      agent_name: z.string(),
      run_id: z.string().nullable(),
      refused_reason: z.string().nullable(),
    }),
  ),
});
export type EvalRunAllResult = z.infer<typeof EvalRunAllResult>;

/** One point on an agent's trend (per completed run, chronological). */
export const EvalTrendPoint = z.object({
  run_id: z.string(),
  ran_at: z.string(),
  agent_version: z.number().int().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/**
 * D12/AC-45 — the dashboard/detail callout. STRUCTURED, not a sentence: the
 * client renders it from `messages/en/eval.json`, which is what keeps it
 * non-model-authored (N1) and makes "no causal clause when `case_transitions`
 * is empty" a rendering invariant rather than a string-building one.
 */
export const EvalCallout = z.object({
  metric: z.enum(['recall', 'precision', 'citation_accuracy']),
  direction: z.enum(['up', 'down']),
  magnitude: z.number(),
  agent_version: z.number().int().nullable(),
  case_transitions: z.array(
    z.object({ case_id: z.string(), name: z.string(), from: z.boolean(), to: z.boolean() }),
  ),
});
export type EvalCallout = z.infer<typeof EvalCallout>;

/** GET /eval/dashboard — one row per agent that has eval cases (AC-40). */
export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  cases_total: z.number().int(),
  latest: EvalRunRecord.nullable(),
  trend: z.array(EvalTrendPoint),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

/**
 * specs/15-skill-eval-cases.md AC-39/D13/D14 — one row per skill owning ≥1
 * case, for the dashboard's OWN skills section (never merged into
 * `EvalAgentSummary`'s list — N9/AC-40). `tokens_per_run` is D13's whole
 * point: the skill's real per-run token cost, read alongside its lift.
 */
export const EvalSkillSummary = z.object({
  skill_id: z.string(),
  skill_name: z.string(),
  cases_total: z.number().int(),
  carrier_agent_name: z.string().nullable(),
  latest: EvalSkillRunRecord.nullable(),
  tokens_per_run: z.number().int().nullable(),
});
export type EvalSkillSummary = z.infer<typeof EvalSkillSummary>;

/** GET /eval/dashboard — workspace-level (AC-40, AC-41); NOT repo-scoped.
 *  `skills` is purely additive (AC-42) — `agents`/`recent_runs` keep their
 *  exact pre-existing shapes. */
export const EvalDashboard = z.object({
  agents: z.array(EvalAgentSummary),
  recent_runs: z.array(EvalRunRecord),
  skills: z.array(EvalSkillSummary),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

/**
 * GET /eval/agents/:id — one agent's eval detail (AC-44/AC-45/AC-48).
 * `delta`/`callout` are null when fewer than two completed runs exist —
 * that IS AC-48's "no deltas, no comparison affordance" expressed in the
 * contract, not a UI-side branch on a count.
 */
export const EvalAgentDetail = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  cases_total: z.number().int(),
  runs: z.array(EvalRunRecord),
  current: EvalRun.nullable(),
  delta: z
    .object({
      recall: z.number().nullable(),
      precision: z.number().nullable(),
      citation_accuracy: z.number().nullable(),
    })
    .nullable(),
  trend: z.array(EvalTrendPoint),
  callout: EvalCallout.nullable(),
});
export type EvalAgentDetail = z.infer<typeof EvalAgentDetail>;

/** GET /eval/compare?a=&b= — exactly two runs of ONE agent (AC-32/33/34). */
export const EvalCompare = z.object({
  old: EvalRunRecord,
  new: EvalRunRecord,
  common_case_ids: z.array(z.string()),
  only_in_old: z.array(z.string()),
  only_in_new: z.array(z.string()),
  deltas: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
  }),
  /** Line-oriented system-prompt diff (AC-34) — added/removed/context, never
   *  a unified-diff string the client would have to parse. */
  prompt_diff: z.array(
    z.object({ kind: z.enum(['added', 'removed', 'context']), text: z.string() }),
  ),
});
export type EvalCompare = z.infer<typeof EvalCompare>;

/**
 * specs/15-skill-eval-cases.md R3/AC-32/AC-33 — a SEPARATE contract from
 * `EvalCompare` (never a widened agent one — AC-42's "behaves exactly as
 * before" would otherwise be broken by even a null-valued added key).
 * `carrier_differs` is AC-32's second axis (alongside the inherited
 * case-set-difference handling); `skill_body_diff` reuses `EvalCompare.
 * prompt_diff`'s line shape (AC-33).
 */
export const EvalSkillCompare = z.object({
  old: EvalSkillRunRecord,
  new: EvalSkillRunRecord,
  common_case_ids: z.array(z.string()),
  only_in_old: z.array(z.string()),
  only_in_new: z.array(z.string()),
  carrier_differs: z.boolean(),
  deltas: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
  }),
  lift_deltas: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
  }),
  skill_body_diff: z.array(
    z.object({ kind: z.enum(['added', 'removed', 'context']), text: z.string() }),
  ),
});
export type EvalSkillCompare = z.infer<typeof EvalSkillCompare>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle. `contents` is `null` for the
 *  runner-bundle's own files in a PREVIEW response (P-4) — the bundle is
 *  never editable and never varies with configuration, so the client fetches
 *  its bytes on demand (`GET /agents/:id/ci/preview/file`) instead of every
 *  file's full text reaching the browser on every Configure change. `bytes`/
 *  `sha256` are always populated, even when `contents` is inlined. */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string().nullable(),
  bytes: z.number().int(),
  sha256: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio (`CiService.agentYaml`) WRITES this shape to
 * `.devdigest/agents/<slug>.yaml`; the agent-runner READS it. Keeping one Zod
 * schema for both ends guarantees the formats never drift. `skills` are slugs
 * resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  // AC-4 — "reopened" is unselected by default; only "opened"/"synchronize"
  // are pre-checked on the Configure step (specs/14-export-to-ci.md R-B).
  triggers: z.array(z.string()).default(['opened', 'synchronize']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** AC-36 — the CI tab list's per-installation "last run" glance, without a
 *  second round-trip to `/ci/runs`. */
export const CiRunSummary = z.object({
  status: CiRunStatus,
  ran_at: z.string(),
  findings_count: z.number().int().nullable(),
});
export type CiRunSummary = z.infer<typeof CiRunSummary>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  branch: z.string(),
  base: z.string(),
  post_as: z.enum(['github_review', 'pr_comment', 'none']),
  triggers: z.array(z.string()),
  workflow_path: z.string(),
  pr_url: z.string().nullable(),
  last_export_at: z.string(),
  // AC-29 — the per-installation refresh debounce's own bookkeeping; `null`
  // before the first refresh ever runs.
  last_refreshed_at: z.string().nullable(),
  last_run: CiRunSummary.nullable(),
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  // `null` when the export was refused (AC-59) or when the GitHub side of
  // the flow didn't run/succeed (`action: 'files'`, AC-10a) — no
  // installation row is written in either case.
  installation: CiInstallation.nullable(),
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
  // AC-7/AC-37 — true when an already-open PR for this installation's branch
  // was found and reused rather than opened fresh. The HTTP status (200 vs
  // 201) carries "first install vs republish"; this carries "PR reused vs new".
  reused_pr: z.boolean(),
  // Non-fatal, surfaced-to-the-user notes (e.g. an unreachable secret-status
  // lookup) — never a reason the export itself failed.
  warnings: z.array(z.string()),
  // AC-59's refusal reason, or AC-10a's "no credential" / "cannot write"
  // reason. Null on a normal, unrefused export.
  refused_reason: z.string().nullish(),
});
export type CiExport = z.infer<typeof CiExport>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts.
 *  All new fields are additive/nullish (AC-49) — a row ingested before a
 *  given field existed still parses. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  /** The CI provider's own run id (e.g. GitHub Actions `run.id`) — what
   *  AC-19's idempotent upsert is keyed on. */
  provider_run_id: z.string().nullish(),
  repo: z.string().nullish(),
  commit_sha: z.string().nullish(),
  pr_number: z.number().int().nullable(),
  pr_title: z.string().nullish(),
  pr_url: z.string().nullish(),
  ran_at: z.string().nullable(),
  status: CiRunStatus.nullable(),
  findings_count: z.number().int().nullable(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  agent_name: z.string().nullish(),
  duration_s: z.number().nullish(),
  /** Clarification 2 (plans/14) — the runner's own review duration from the
   *  artifact, falling back to the provider's job wall-clock when no
   *  artifact exists. `duration_source` says which one this value is. */
  duration_ms: z.number().int().nullish(),
  duration_source: z.enum(['artifact', 'provider']).nullish(),
  /** Set only when `status === 'failed'` — names which check failed
   *  (AC-18) or why the run has no artifact (AC-21). */
  failure_reason: z.string().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 *
 * NOT modified by specs/14-export-to-ci.md (D-P2): it is compiled into the
 * `agent-runner` bundle through this same file, so changing it would
 * silently change the runner (N5). It carries no commit sha and no
 * repository — `CiRunMeta` below is the sidecar that supplies both.
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

/**
 * D-P2 sidecar — written by the GENERATED WORKFLOW (never the runner) as
 * `devdigest-run.json`, alongside `devdigest-result.json`, from GitHub
 * Actions context passed through a step-level `env:` block. Gives the
 * ingest boundary (AC-18) something to authenticate the artifact against:
 * `CiResultArtifact` alone carries no commit sha and no repository, so the
 * "commit matches" / "repository matches" checks would otherwise be vacuous.
 */
export const CiRunMeta = z.object({
  commit_sha: z.string().min(1),
  repository: z.string().min(1),
  pr_number: z.number().int(),
});
export type CiRunMeta = z.infer<typeof CiRunMeta>;

/** AC-64/P-7 — three states, not two: a 403 on the secrets-read endpoint
 *  (the common case for a local-mode credential without `Secrets: read`)
 *  must render as `'unknown'`, never `'missing'` (which would wrongly tell
 *  the user to add a secret they may already have) and never block the
 *  wizard. Never carries a secret value. */
export const CiSecretStatus = z.object({
  name: z.string(),
  required: z.boolean(),
  state: z.enum(['configured', 'missing', 'unknown']),
  provided_by_ci: z.boolean(),
});
export type CiSecretStatus = z.infer<typeof CiSecretStatus>;

/** `POST /agents/:id/ci/preview` response — the bundle plus everything the
 *  Configure/Install steps need without a second round-trip (AC-3/AC-4c/AC-9/
 *  AC-64). */
export const CiPreview = z.object({
  files: z.array(CiFile),
  secrets: z.array(CiSecretStatus),
  warnings: z.array(z.string()),
});
export type CiPreview = z.infer<typeof CiPreview>;

/** `GET /ci/targets` — the generator registry's own projection (AC-2/AC-2a):
 *  registering a second generator makes a second option appear with zero
 *  change to this contract or the Target step. */
export const CiTargetOption = z.object({
  target: CiTarget,
  label_key: z.string(),
});
export type CiTargetOption = z.infer<typeof CiTargetOption>;

/** `GET /ci/runs` — the list plus the filter vocabularies the same read
 *  already has on hand (AC-28), so the client never derives them from the
 *  (possibly filtered) row set it's showing. */
export const CiRunsPage = z.object({
  runs: z.array(CiRun),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  repos: z.array(z.string()),
});
export type CiRunsPage = z.infer<typeof CiRunsPage>;

/** `POST /ci/refresh` response (AC-29). `degraded: true` means "could not
 *  refresh from the provider, showing stored data" — the list is never
 *  emptied because a refresh failed. */
export const CiRefreshResult = z.object({
  checked: z.number().int(),
  ingested: z.number().int(),
  failed: z.number().int(),
  skipped_debounced: z.number().int(),
  degraded: z.boolean(),
  reason: z.string().nullable(),
});
export type CiRefreshResult = z.infer<typeof CiRefreshResult>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
