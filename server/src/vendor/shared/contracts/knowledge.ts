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
  /**
   * Read-only usage aggregates for the list-card footer. Nullish because a
   * caller with no cheap way to compute them (a version snapshot, an export)
   * should omit the fields rather than report a wrong 0 — see `skill_count` on
   * `Agent` for the same convention.
   *
   * `pull_rate`/`accept_rate` come from `run_skill_links`, a record of which
   * runs had this skill in their prompt — see specs/02-skill-detail-tabs.md.
   * `accept_rate` is an ASSOCIATION, not attribution: a skill sitting in the
   * prompt beside four others gets credit for all five's findings.
   */
  used_by_agents: z.number().int().nullish(),
  pull_rate: z.number().nullable().optional(),
  accept_rate: z.number().nullable().optional(),
});
export type Skill = z.infer<typeof Skill>;

/** One immutable body snapshot from `skill_versions`, newest first in listings. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

/**
 * Caps on a persisted skill. They live in the CONTRACT, not only in the
 * importer, because import is stateless by design: the extractor returns a
 * preview and the client POSTs it back through the ordinary create route. A cap
 * enforced only in `import.ts` is therefore a cap on the polite path — and a
 * skill body is rendered into every linked agent's prompt as instructions.
 */
export const MAX_SKILL_BODY_CHARS = 200_000;
export const MAX_SKILL_NAME_CHARS = 200;
export const MAX_SKILL_DESCRIPTION_CHARS = 2_000;

export const CreateSkillBody = z.object({
  name: z.string().min(1).max(MAX_SKILL_NAME_CHARS),
  description: z.string().max(MAX_SKILL_DESCRIPTION_CHARS).default(''),
  type: SkillType,
  /**
   * Provenance. Immutable once set — `UpdateSkillBody` deliberately omits it, so
   * a skill that arrived from someone else's archive can never be relabelled
   * `manual` and lose the "untrusted source" badge it is meant to carry.
   */
  source: SkillSource.default('manual'),
  body: z.string().min(1).max(MAX_SKILL_BODY_CHARS),
  /**
   * Whether this skill contributes to any agent's prompt. Imported skills are
   * created with `false`: a skill body reaches the model as INSTRUCTIONS (it is
   * not `<untrusted>`-fenced — see specs/01-skills.md), so a human vetting it is
   * the only gate between a downloaded file and the agent's prompt.
   */
  enabled: z.boolean().default(true),
});
/**
 * Post-parse shape — every defaulted field is present. This is what a handler
 * sees; it is NOT what a caller sends.
 */
export type CreateSkillBody = z.infer<typeof CreateSkillBody>;
/** What a CALLER sends: the defaulted fields are optional. Use this client-side. */
export type CreateSkillBodyInput = z.input<typeof CreateSkillBody>;

export const UpdateSkillBody = z.object({
  name: z.string().min(1).max(MAX_SKILL_NAME_CHARS).optional(),
  description: z.string().max(MAX_SKILL_DESCRIPTION_CHARS).optional(),
  type: SkillType.optional(),
  body: z.string().min(1).max(MAX_SKILL_BODY_CHARS).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateSkillBody = z.infer<typeof UpdateSkillBody>;

/**
 * Body of `POST /skills/import/preview`.
 *
 * Base64 in a JSON body rather than multipart, so the upload is validated by a
 * Zod schema at the edge like every other route instead of bypassing that path.
 * Skills are prose measured in kilobytes; the streaming multipart would buy is
 * worth nothing here.
 */
export const SkillImportPreviewBody = z.object({
  filename: z.string().min(1).max(255),
  content_base64: z.string().min(1),
});
export type SkillImportPreviewBody = z.infer<typeof SkillImportPreviewBody>;

/**
 * The result of extracting a skill from an uploaded `.md` or `.zip`. Nothing is
 * persisted to produce this — the user confirms the preview, and the client then
 * POSTs it as a normal create. Round-tripping through the client (rather than
 * holding server-side state between the two steps) keeps import stateless and
 * makes "saved only after confirmation" true by construction.
 */
export const SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  /**
   * Provenance, decided by the EXTRACTOR and forwarded verbatim by the confirm
   * step. It is here so the disabled-on-arrival rule does not depend on a client
   * remembering to declare where the body came from — a second import entry
   * point that forgot would otherwise persist someone else's instructions as
   * `manual`, enabled, with no "untrusted source" badge.
   */
  source: SkillSource,
  body: z.string(),
  /** Entry the body was taken from — `skill.md`, or `security/SKILL.md` in a zip. */
  source_path: z.string(),
  /**
   * Archive entries that were NOT read. The extractor takes markdown only, so
   * scripts, binaries and manifests all land here. Surfaced in the preview so
   * "executable parts are not processed" is something the user can see, not just
   * something we claim.
   */
  ignored: z.array(z.string()),
  size_bytes: z.number().int(),
});
export type SkillImportPreview = z.infer<typeof SkillImportPreview>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
export const ConventionCandidate = z.object({
  id: z.string(),
  /** Free-text label the model proposed, e.g. "naming", "error-handling". */
  category: z.string(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_start_line: z.number().int(),
  evidence_end_line: z.number().int(),
  /**
   * Always the verified on-disk excerpt at [evidence_start_line,
   * evidence_end_line] — never the model's raw paraphrase. See
   * specs/03-conventions.md for why evidence is re-derived from disk rather
   * than trusted from the model.
   */
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  accepted: z.boolean(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/** Response of both `POST /repos/:id/conventions/extract` and `GET /repos/:id/conventions`. */
export const ConventionScan = z.object({
  sampled_files: z.number().int(),
  /** ISO timestamp of the last extraction run for this repo, null if never scanned. */
  scanned_at: z.string().nullable(),
  candidates: z.array(ConventionCandidate),
});
export type ConventionScan = z.infer<typeof ConventionScan>;

/**
 * Body of `PATCH /conventions/:id`. Covers both the accept/reject toggle and
 * editing a candidate's own prose (`rule`/`category`) — evidence fields are
 * NOT editable here since they are mechanically grounded against disk.
 */
export const PatchConventionBody = z
  .object({
    accepted: z.boolean().optional(),
    rule: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
  })
  .refine((b) => b.accepted !== undefined || b.rule !== undefined || b.category !== undefined, {
    message: 'Provide at least one of accepted, rule, category',
  });
export type PatchConventionBody = z.infer<typeof PatchConventionBody>;

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
  /**
   * How many skills are attached to this agent — a read-only count for the
   * agent card, not part of the agent's config. Nullish so a caller that has no
   * cheap way to count (a version snapshot, an export) can omit it rather than
   * report a wrong 0.
   */
  skill_count: z.number().int().nullish(),
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
