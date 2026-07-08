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

export const SkillSource = z.enum(['manual', 'imported_url', 'imported_file', 'extracted', 'community']);
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

export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

export const ImportPreview = z.object({
  name: z.string(),
  type: SkillType,
  body: z.string(),
  token_estimate: z.number().int(),
  source_file: z.string(),
  ignored_files: z.array(z.string()),
});
export type ImportPreview = z.infer<typeof ImportPreview>;

export const SkillStats = z.object({
  used_by: z.number().int(),
  pull_frequency_pct: z.number(),
  accept_rate_pct: z.number(),
  findings_30d: z.number().int(),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  findings_by_category: z.array(z.object({ category: z.string(), count: z.number().int() })),
});
export type SkillStats = z.infer<typeof SkillStats>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
export const ConventionStatus = z.enum([
  'pending',
  'verified',
  'rejected_evidence',
  'accepted',
  'rejected_user',
  'edited',
]);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionScanStatus = z.enum(['pending', 'running', 'done', 'failed']);
export type ConventionScanStatus = z.infer<typeof ConventionScanStatus>;

export const Convention = z.object({
  id: z.string(),
  workspace_id: z.string(),
  repo_id: z.string().nullable(),
  scan_id: z.string().nullish(),
  category: z.string().nullish(),
  rule: z.string(),
  edited_rule: z.string().nullish(),
  evidence_path: z.string().nullish(),
  evidence_snippet: z.string().nullish(),
  evidence_line: z.number().int().nullish(),
  evidence_line_end: z.number().int().nullish(),
  evidence_url: z.string().nullish(),
  model_confidence: z.number().min(0).max(1).nullish(),
  verified_confidence: z.number().min(0).max(1).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  status: ConventionStatus,
  accepted: z.boolean(),
  dedup_key: z.string().nullish(),
  created_at: z.string(),
});
export type Convention = z.infer<typeof Convention>;

export const ConventionScan = z.object({
  id: z.string(),
  workspace_id: z.string(),
  repo_id: z.string(),
  commit_sha: z.string(),
  status: ConventionScanStatus,
  scanned_file_count: z.number().int().nullish(),
  candidate_count: z.number().int().nullish(),
  verified_count: z.number().int().nullish(),
  created_at: z.string(),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

export const ConventionSkillInput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('merge'),
    name: z.string().min(1),
    description: z.string(),
    type: SkillType,
  }),
  z.object({
    mode: z.literal('grouped'),
    groups: z.array(
      z.object({
        category: z.string(),
        name: z.string().min(1),
        description: z.string(),
        type: SkillType,
      }),
    ),
  }),
]);
export type ConventionSkillInput = z.infer<typeof ConventionSkillInput>;

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
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// Compact usage rollup for the Agents LIST card footer (runs · accept% · avg
// cost · skills). Distinct from the heavier per-agent `AgentStats` detail
// contract (observability.ts) so the list query stays cheap. Aggregated from
// `agent_runs` and finding actions (accept rate over accepted+dismissed
// findings). `accept_pct` / `avg_cost_usd` are null when nothing to average.
export const AgentCardStats = z.object({
  agent_id: z.string(),
  runs: z.number().int(),
  skill_count: z.number().int(),
  accept_pct: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
});
export type AgentCardStats = z.infer<typeof AgentCardStats>;

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
  // Metadata ABOUT this version row (not part of the frozen config snapshot):
  // how it came to exist — a manual edit, or promoted from an eval batch's
  // agent_snapshot (Agent Eval Dashboard). `source_batch_id` is the promoting
  // batch's id when `source === 'eval_promote'`. Both `.nullish()` — absent on
  // any version row written before this feature existed.
  source: z.enum(['manual', 'eval_promote']).nullish(),
  source_batch_id: z.string().nullish(),
});
export type AgentVersion = z.infer<typeof AgentVersion>;
