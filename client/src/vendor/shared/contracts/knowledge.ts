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
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

export const EvalRun = z.object({
  recall: z.number().min(0).max(1),
  precision: z.number().min(0).max(1),
  citation_accuracy: z.number().min(0).max(1),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  duration_ms: z.number().int(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCase = z.infer<typeof EvalCase>;

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

// Where a skill came from. Display provenance only — NOT a trust gate: every
// enabled skill body is injected into the prompt as trusted instructions.
// Mirrored by the Drizzle column enum in db/schema/skills.ts — widen both.
export const SkillSource = z.enum([
  'manual',
  'imported_url',
  'extracted',
  'community',
  'imported_file',
]);
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

// ---- Conventions ----
/**
 * What the extractor looks for, one focused LLM pass per category. Mirrored by
 * the Drizzle column enum in db/schema/knowledge.ts — widen both, but no
 * migration (plain `text`, no CHECK).
 *
 * `testing` is deliberately absent: the sample files come from
 * repo-intel's `getConventionSamples`, which routes through `isJunkPath` and
 * drops `.test.` / `.spec.` / `__tests__/`. A testing category would have no
 * files left to cite evidence from.
 */
export const ConventionCategory = z.enum([
  'naming',
  'structure',
  'error_handling',
  'async',
  'imports',
  'typing',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

/**
 * Triage state. Replaces the original `accepted: boolean` — a two-state flag
 * cannot express *rejected*, and the rejected set is what a re-scan dedups
 * against so the user is not re-shown a rule they already turned down.
 */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

/**
 * Which corpus a rule's conformance was counted over. The strategy is chosen by
 * the SERVER from the rule's category, never by the model — `naming` is counted
 * over declarations, `structure` over paths, everything else over source text.
 *
 * Mirrored by the Drizzle column enum in db/schema/knowledge.ts — widen both, but
 * no migration (plain `text`, no CHECK).
 */
export const ProbeStrategy = z.enum(['text', 'symbols', 'paths']);
export type ProbeStrategy = z.infer<typeof ProbeStrategy>;

/**
 * The per-signal breakdown behind `confidence` — the "why this score" payload.
 *
 * `capped` is the honest part: it marks a rule whose denominator could not be
 * measured, so its score was bounded rather than allowed to read as certainty.
 */
export const ConventionSignals = z.object({
  strategy: ProbeStrategy,
  support: z.number().min(0).max(1),
  spread: z.number().min(0).max(1),
  model: z.number().min(0).max(1),
  dirs: z.number().int(),
  /** Sites examined vs corpus size — surfaces a budget-truncated count. */
  examined: z.number().int(),
  corpus_size: z.number().int(),
  config_declared: z.boolean(),
  /** `INCOMPLETE_SIGNAL_CAP` bound the score: no denominator was measurable. */
  capped: z.boolean(),
});
export type ConventionSignals = z.infer<typeof ConventionSignals>;

/**
 * One proposed house rule, grounded in a real line of the repo.
 *
 * `evidence_start_line` / `evidence_end_line` are the lines the snippet was
 * actually FOUND at, not the ones the model claimed — a candidate whose snippet
 * cannot be located in the file it cites is dropped rather than shown.
 * `confidence` is likewise re-derived from measured conformance, not the model's
 * self-report.
 *
 * Two counts, deliberately not one:
 *  - `support_count` is and stays `support_files.length` — distinct FILES that
 *    follow the rule. It is what the UI meter reads and what seeded rows carry.
 *  - `follow_count` counts conforming SITES in the strategy's own unit, so for a
 *    `symbols` rule it may exceed `support_count` (30 declarations across 14 files).
 *
 * `violation_count` / `conformance` are nullable ON PURPOSE: `null` means "we could
 * not measure a denominator", which is a different claim from `0` ("we measured, and
 * found no violations"). Collapsing the two would turn an unverifiable rule into a
 * perfect one.
 */
export const ConventionCandidate = z.object({
  id: z.string(),
  category: ConventionCategory.nullish(),
  rule: z.string(),
  rationale: z.string().nullish(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  evidence_start_line: z.number().int().nullish(),
  evidence_end_line: z.number().int().nullish(),
  support_count: z.number().int(),
  support_files: z.array(z.string()).nullish(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  skill_id: z.string().nullish(),
  /** Conforming sites, in the strategy's unit. May exceed `support_count`. */
  follow_count: z.number().int().nullish(),
  /** Violating sites. `null` = unmeasurable, NOT zero. */
  violation_count: z.number().int().nullish(),
  /** `follow / (follow + violate)`, or null when unmeasurable. */
  conformance: z.number().min(0).max(1).nullish(),
  probe_strategy: ProbeStrategy.nullish(),
  /** A config file we actually read declares this rule, and we verified the quote. */
  config_declared: z.boolean().nullish(),
  signals: ConventionSignals.nullish(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

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
  // How many skills are linked to this agent. Denormalized onto the list
  // response so the agent cards don't need N requests to `/agents/:id/skills`.
  // Defaults to 0 on endpoints that don't compute it.
  skill_count: z.number().int().default(0),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
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

/**
 * Body of `POST /agents/:id/restore` — write an OLD version's config forward as
 * a new one (the eval compare modal's `Promote vN`).
 *
 * The client sends a version NUMBER, never a config. `agent_versions` rows are
 * append-only — nothing in the repository ever UPDATEs one — so a version number
 * is a permanently stable handle on immutable config: a stale version cache can
 * never cause a wrong write, only a failure to offer a newer version. That is
 * what lets this endpoint carry no `If-Match` and no precondition.
 *
 * A restore does NOT rewind the counter. It replays `AgentVersionConfig` (the
 * whole snapshot, linked skill ids included — that snapshot *is* the agent's
 * identity for eval reproducibility) as the next version, so history is never
 * overwritten. Restoring the config the agent already has is a no-op.
 */
export const AgentRestoreRequest = z.object({
  version: z.number().int().positive(),
});
export type AgentRestoreRequest = z.infer<typeof AgentRestoreRequest>;
