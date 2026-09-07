import { z } from 'zod';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
// specs/10-onboarding-generator.md. `OnboardingSection.kind` is tightened from
// a free string to the fixed 5-kind enum (AC-16) — free to do, since this
// contract had zero consumers before this feature. `entries` carries the
// reading-path / critical-path rows as structured, server-ordered data (AC-26,
// AC-27, AC-44) rather than as prose inside `body`.
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSectionKind = z.enum([
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
]);
export type OnboardingSectionKind = z.infer<typeof OnboardingSectionKind>;

/**
 * One reading-path / critical-path row. `path` is repo-relative and, for a
 * critical-path entry, the CHAIN ROOT — the only sensible link target
 * (`githubBlobUrl` takes exactly one path). `chain` carries the remaining
 * hops (breadcrumb text only, never links); `reason` is the model's one
 * sentence, omitted when the model didn't supply one for a deterministic
 * entry (Q4) rather than the entry being dropped.
 */
export const OnboardingEntry = z.object({
  path: z.string(),
  chain: z.array(z.string()).nullish(),
  reason: z.string().nullish(),
});
export type OnboardingEntry = z.infer<typeof OnboardingEntry>;

export const OnboardingSection = z.object({
  kind: OnboardingSectionKind,
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
  /** Structured rows for `critical_paths` / `reading_path`; absent on the
   *  other three kinds. */
  entries: z.array(OnboardingEntry).nullish(),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

/** AC-30's provenance line + AC-21's spend record, in one object. Present on
 *  every tour AND every skeleton — the spend fields (`model` onward) are
 *  populated only once a generation has actually succeeded. */
export const OnboardingProvenance = z.object({
  files_indexed: z.number().int(),
  files_excluded: z.number().int(),
  index_status: z.string(),
  index_reason: z.string().nullish(),
  index_sha: z.string(),
  index_updated_at: z.string().nullish(),
  prs_weighted: z.number().int(),
  hotness_window_days: z.number().int(),
  generated_at: z.string().nullish(),
  model: z.string().nullish(),
  provider: z.string().nullish(),
  attempts: z.number().int().nullish(),
  tokens_in: z.number().int().nullish(),
  tokens_out: z.number().int().nullish(),
  cost_usd: z.number().nullish(),
});
export type OnboardingProvenance = z.infer<typeof OnboardingProvenance>;

export const OnboardingStatus = z.enum([
  'generated',
  'stale',
  'skeleton',
  'degraded',
  'empty',
  'generating',
  'failed',
  'refused',
]);
export type OnboardingStatus = z.infer<typeof OnboardingStatus>;

/** One detected/collected fact with the file that evidenced it (AC-2, AC-4). */
export const OnboardingEvidence = z.object({
  value: z.string(),
  evidence_file: z.string().nullish(),
});
export type OnboardingEvidence = z.infer<typeof OnboardingEvidence>;

export const OnboardingStackFacts = z.object({
  language: OnboardingEvidence.nullish(),
  runtime: OnboardingEvidence.nullish(),
  package_manager: OnboardingEvidence.nullish(),
  frameworks: z.array(OnboardingEvidence),
});
export type OnboardingStackFacts = z.infer<typeof OnboardingStackFacts>;

export const OnboardingRankedFileFact = z.object({
  path: z.string(),
  pagerank: z.number(),
  hotness: z.number(),
  weighted: z.number(),
});
export type OnboardingRankedFileFact = z.infer<typeof OnboardingRankedFileFact>;

export const OnboardingSetupStepFact = z.object({
  command: z.string(),
  kind: z.string(),
  evidence_file: z.string(),
});
export type OnboardingSetupStepFact = z.infer<typeof OnboardingSetupStepFact>;

export const OnboardingRouteFact = z.object({
  file: z.string(),
  endpoints: z.array(z.string()),
  crons: z.array(z.string()),
});
export type OnboardingRouteFact = z.infer<typeof OnboardingRouteFact>;

/** AC-35's skeleton facts — the same four groups whether rendered as the
 *  skeleton (no LLM call) or shown alongside a generated tour. */
export const OnboardingFacts = z.object({
  stack: OnboardingStackFacts,
  ranked_files: z.array(OnboardingRankedFileFact),
  setup_steps: z.array(OnboardingSetupStepFact),
  routes: z.array(OnboardingRouteFact),
});
export type OnboardingFacts = z.infer<typeof OnboardingFacts>;

/** What grounding dropped on the last generation (AC-27..AC-32) — reported
 *  alongside a POST response so the client can be honest about it. */
export const OnboardingDropped = z.object({
  paths: z.array(z.string()),
  commands: z.array(z.string()),
  links: z.array(z.string()),
  tasks: z.array(z.string()),
});
export type OnboardingDropped = z.infer<typeof OnboardingDropped>;

/** GET /repos/:id/tour response shape. */
export const OnboardingPage = z.object({
  status: OnboardingStatus,
  reason: z.string().nullish(),
  /** True when the index has advanced past the state `tour` was generated
   *  from (AC-23); always false when `tour` is null. */
  stale: z.boolean(),
  provenance: OnboardingProvenance,
  facts: OnboardingFacts,
  tour: Onboarding.nullable(),
});
export type OnboardingPage = z.infer<typeof OnboardingPage>;

/** POST /repos/:id/tour/generate response shape — the same envelope plus
 *  what grounding dropped on THIS generation (null when nothing was dropped,
 *  or the call never reached grounding). */
export const OnboardingGenerateResult = OnboardingPage.extend({
  dropped: OnboardingDropped.nullish(),
});
export type OnboardingGenerateResult = z.infer<typeof OnboardingGenerateResult>;

// ---- Eval ----
// specs/12-eval-pipeline.md (L06) — reshaped in place (D1/D3): the base case
// and set-level metrics shape live here; the API-facing request/response
// shapes (create/edit payload, persisted suite-run record, dashboard) live in
// `eval-ci.ts`.
export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

/** D3 — a case's expectation type is explicit and closed-vocabulary, never
 *  inferred from the shape of a JSON blob. Both 'agent'-owned and (as of
 *  specs/15-skill-eval-cases.md) 'skill'-owned cases use it identically. */
export const EvalExpectationType = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationType = z.infer<typeof EvalExpectationType>;

/** `severity`/`category`/`title` are carried from the source finding (AC-38's
 *  tags) — display metadata, not part of the matching predicate itself. */
export const EvalExpectation = z.object({
  type: EvalExpectationType,
  file: z.string().min(1),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: z.string().nullish(),
  category: z.string().nullish(),
  title: z.string().nullish(),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/** D16 — the trimmed, frozen PR metadata a case's frozen input carries.
 *  Never a repo id, never a live pointer (D8). */
export const EvalCaseMeta = z.object({
  pr_number: z.number().int().nullable(),
  title: z.string(),
  body: z.string().nullable(),
});
export type EvalCaseMeta = z.infer<typeof EvalCaseMeta>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.array(z.string()),
  input_meta: EvalCaseMeta,
  expectation: EvalExpectation,
  /** The finding this case was created from — null for a hand-authored /
   *  fixture case (D17's idempotency key when present). */
  source_finding_id: z.string().nullable(),
  notes: z.string().nullish(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type EvalCase = z.infer<typeof EvalCase>;

/** A display slice of a finding produced during an eval run — declared here
 *  (not imported from `findings.ts`) so this file gains no new import edge. */
export const EvalActualFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: z.string(),
  category: z.string(),
  title: z.string(),
  matched: z.boolean(),
});
export type EvalActualFinding = z.infer<typeof EvalActualFinding>;

/** Q1 — one case's outcome within a suite run (the reserved `EvalPerTrace`
 *  reshaped: renamed, and widened from `{name,pass,expected,actual}` into a
 *  structured, deterministic outcome). `pass` is null exactly when
 *  `status === 'errored'` (AC-11). */
export const EvalCaseOutcome = z.object({
  case_id: z.string(),
  name: z.string(),
  expectation_type: EvalExpectationType,
  status: z.enum(['scored', 'errored']),
  pass: z.boolean().nullable(),
  error_reason: z.string().nullable(),
  findings_total: z.number().int(),
  findings_matched: z.number().int(),
  grounding_kept: z.number().int(),
  grounding_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  actual: z.array(EvalActualFinding),
});
export type EvalCaseOutcome = z.infer<typeof EvalCaseOutcome>;

/** Q1 — the SET-LEVEL metrics object for one suite run (kept as-is; this
 *  reserved shape already matched the feature). The three ratios are
 *  nullable — AC-20's "not applicable" must be stated, never a fake 0/1. */
export const EvalRun = z.object({
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  cases_errored: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_case: z.array(EvalCaseOutcome),
});
export type EvalRun = z.infer<typeof EvalRun>;

// ---- Eval — skill-owned (specs/15-skill-eval-cases.md, D5/D3) ----
/** D5 — a closed, deterministic four-value classification of one case's
 *  effect across the two arms of a skill-owned run. An errored (hence
 *  unpaired) case is never classified — it is simply absent from the array
 *  that carries these, not bucketed as `no_effect_fail`. */
export const EvalCaseEffect = z.enum(['helped', 'hurt', 'no_effect_pass', 'no_effect_fail']);
export type EvalCaseEffect = z.infer<typeof EvalCaseEffect>;

/** One case's effect classification within a skill-owned run (AC-20/AC-35). */
export const EvalSkillCaseEffect = z.object({
  case_id: z.string(),
  name: z.string(),
  effect: EvalCaseEffect,
});
export type EvalSkillCaseEffect = z.infer<typeof EvalSkillCaseEffect>;

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
});
export type Skill = z.infer<typeof Skill>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

/** Skill names are slugs — the editor renders one as `<name>.md`. */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const SkillName = z.string().min(1).max(64).regex(SKILL_NAME_RE);

/**
 * Parse result of an uploaded `.md` / `.zip`, returned by `POST /skills/import`.
 * NOTHING is persisted at this point — the client shows this for confirmation
 * and only then calls `POST /skills`.
 */
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  /** Which archive entry the body came from; null for a plain .md upload. */
  source_path: z.string().nullish(),
  /** How many other entries the archive had. They were NOT read or extracted. */
  ignored_entries: z.number().int(),
  /** Present when the archive held more than one SKILL.md and the user must pick. */
  candidates: z.array(z.string()).nullish(),
  /** An existing skill with this name — the UI offers replace / rename. */
  collides_with: z.string().nullish(),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

/**
 * The skill exactly as the run executor will inject it, plus its real token
 * cost. `block` is produced by the SAME renderer the executor uses — if these
 * two ever diverge, the Preview tab is lying.
 */
export const SkillPreview = z.object({
  block: z.string(),
  tokens: z.number().int(),
  /**
   * specs/09-project-context-folder.md — this skill's own attached documents,
   * rendered exactly as a run would inject them (AC-13/D1: same heading, same
   * renderer as the assembled `## Project context` block — a preview that
   * formats differently would be lying about what the model receives). Null
   * when the skill has no attached documents, mirroring the run's own
   * omit-when-empty contract for that section.
   */
  project_context_block: z.string().nullable(),
  /** Token cost of `project_context_block` (0 when null) — the SAME tokenizer
   *  as `tokens` above, never a separate estimate (AC-6). */
  project_context_tokens: z.number().int(),
});
export type SkillPreview = z.infer<typeof SkillPreview>;

/**
 * Skill Stats tab. Findings figures are attributed at RUN level: a run that
 * injected four skills counts its findings toward all four. The UI says so —
 * "findings in runs using this skill", never "caused by".
 *
 * `null` means unmeasured (no runs / nothing judged yet) and renders as "—";
 * a measured zero renders as 0. Those are different facts.
 */
export const SkillStats = z.object({
  used_by: z.number().int(),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  pull_pct: z.number().nullable(),
  accept_pct: z.number().nullable(),
  findings_30d: z.number().int(),
  by_category: z.array(z.object({ category: z.string(), count: z.number().int() })),
  avg_tokens: z.number().int().nullable(),
});
export type SkillStats = z.infer<typeof SkillStats>;

/** Rail-card stats — the cheap subset, batched for the whole list. */
export const SkillListStats = z.object({
  used_by: z.number().int(),
  pull_pct: z.number().nullable(),
  accept_pct: z.number().nullable(),
});
export type SkillListStats = z.infer<typeof SkillListStats>;

/** A skill plus its rail-card stats — the `GET /skills` row shape. */
export const SkillWithStats = Skill.extend({ stats: SkillListStats });
export type SkillWithStats = z.infer<typeof SkillWithStats>;

/** One archived body from `skill_versions`. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

// ---- Conventions ----
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionCandidate = z.object({
  id: z.string(),
  category: z.string(),
  rule: z.string(),
  evidence_path: z.string().nullable(),
  evidence_start_line: z.number().int().nullable(),
  evidence_end_line: z.number().int().nullable(),
  evidence_snippet: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  status: ConventionStatus,
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/** One extraction run — what was sampled, against which commit, by which model. */
export const ConventionScan = z.object({
  id: z.string(),
  repo_id: z.string(),
  sample_file_count: z.number().int(),
  source_sha: z.string(),
  model: z.string(),
  created_at: z.string(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/** GET /repos/:id/conventions — the latest scan (if any) plus its candidates. */
export const ConventionsList = z.object({
  scan: ConventionScan.nullable(),
  candidates: z.array(ConventionCandidate),
});
export type ConventionsList = z.infer<typeof ConventionsList>;

/** POST /repos/:id/conventions/skill request body. */
export const CreateSkillFromConventionsRequest = z.object({
  convention_ids: z.array(z.string()).min(1),
  name: SkillName,
  description: z.string().min(1),
  enabled: z.boolean().default(false),
  /** Editable in the "Create skill" modal before saving; server renders the
   *  default (rule + evidence citation per candidate) when omitted. */
  body: z.string().min(1).optional(),
});
export type CreateSkillFromConventionsRequest = z.infer<typeof CreateSkillFromConventionsRequest>;

// ---- Agents ----
// 'openrouter' routes through the OpenAI-compatible API (OpenAIProvider with a
// custom baseURL) — used by the CI runner for cheap models (DeepSeek/GLM/MiniMax).
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a review should BLOCK (REQUEST_CHANGES + fail the check)
// vs just comment. Deterministic from finding severities, NOT the model's verdict:
//  - never:    never block, always comment (advisory only)
//  - critical: block iff >=1 CRITICAL finding (default)
//  - warning:  block iff >=1 WARNING or CRITICAL finding
//  - any:      block iff >=1 finding of any severity
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
  /**
   * Per-agent gate. The link survives being switched off so `order` is kept —
   * re-enabling restores the skill's place instead of appending it. A skill is
   * injected only when this AND `Skill.enabled` are both true.
   */
  enabled: z.boolean().default(true),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// The immutable config snapshot captured in `agent_versions` whenever an agent's
// config changes (everything but `enabled`). Mirrors the shape written by the
// agents repository — provider/model/prompt/output_schema/strategy/gate/repo_intel
// plus the ordered skill ids linked at snapshot time. Used for reproducibility
// (eval replays a past version) and for surfacing an agent's edit history.
export const AgentVersionConfig = z.object({
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: ReviewStrategy,
  ci_fail_on: CiFailOn,
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
});
export type AgentVersionConfig = z.infer<typeof AgentVersionConfig>;

export const AgentVersion = z.object({
  agent_id: z.string(),
  version: z.number().int(),
  config: AgentVersionConfig,
  created_at: z.string(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
