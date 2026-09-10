import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
  /** file_rank.rank of the caller file; `0` = no rank data (degraded path). */
  rank: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  /** Optional one-LLM-call summary paragraph — out of scope for the
   *  deterministic Blast Radius endpoint (specs/07), so legitimately absent
   *  on that path. Reserved for the later PR Brief composition. */
  summary: z.string().nullish(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

// specs/11-why-risk-brief.md clarification 6 (normative) — the closed `kind`
// vocabulary a risk area must be drawn from. `other` is the required
// normalisation target (AC-15) for anything the model invents; the client's
// icon/colour mapping (AC-37) is total over exactly this set.
export const RiskKind = z.enum([
  'auth_surface',
  'dependency',
  'performance',
  'data_migration',
  'api_contract',
  'config_secrets',
  'test_coverage',
  'other',
]);
export type RiskKind = z.infer<typeof RiskKind>;

export const Risk = z.object({
  kind: RiskKind,
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  /**
   * Repo-relative file citations — always server-constructed (grounding
   * renders these AFTER checking each candidate against the fact set; the
   * model never emits this exact string). Encoding: `"<path>"` when no line
   * survived grounding (AC-20), else `"<path>:<line>"`.
   */
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR Brief (specs/11-why-risk-brief.md) --------------------------------
// D6: PrBrief is redesigned in place — it now composes a single model-authored
// artifact (what/why/risk_level/risks/review_focus), not the old
// intent+blast+risks+history composition (D7: intent/blast keep their own
// live read surfaces; history leaves the composition entirely, N1/N10).

/**
 * One "read this first" entry (AC-38). Structured — not a `"path:line"`
 * string — because this is what AC-39's click-to-file-line navigation reads.
 */
export const ReviewFocusItem = z.object({
  file: z.string(),
  /** `null` when no line survived grounding (AC-20) — file-level only. */
  line: z.number().int().nullable(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

export const PrBrief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(Risk),
  review_focus: z.array(ReviewFocusItem),
});
export type PrBrief = z.infer<typeof PrBrief>;

/** AC-41's seven distinct states. `earlier_state` covers BOTH "the head sha
 *  moved since generation" and "never generated for this state" — one
 *  marker, always visible (clarification 3). */
export const BriefStatus = z.enum([
  'none',
  'generating',
  'generated',
  'earlier_state',
  'possibly_stale',
  'refused',
  'failed',
]);
export type BriefStatus = z.infer<typeof BriefStatus>;

/** AC-29/AC-43 — everything recorded about the ONE successful generation a
 *  stored brief carries. Present only once a brief has actually been
 *  generated (`BriefPage.provenance` is nullable). */
export const BriefProvenance = z.object({
  /** D9 — the state key: the PR head sha this brief was generated from. */
  head_sha: z.string(),
  generated_at: z.string(),
  model: z.string(),
  provider: z.string(),
  attempts: z.number().int(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  cost_usd: z.number().nullable(),
  /** AC-32: an absent/degraded index still generates — nullable, not absent. */
  index_sha: z.string().nullable(),
  index_status: z.string(),
  index_reason: z.string().nullable(),
  /** AC-35: intent may be absent at generation time. */
  intent_resolved_at: z.string().nullable(),
  /** AC-8: how many whole input items were dropped to fit the budget. */
  dropped_inputs: z.number().int(),
});
export type BriefProvenance = z.infer<typeof BriefProvenance>;

/** What grounding removed on the LAST generation (AC-16..AC-21) — reported
 *  alongside a POST response so the client can be honest about it. */
export const BriefDropped = z.object({
  paths: z.array(z.string()),
  lines: z.array(z.string()),
  citations: z.array(z.string()),
  links: z.array(z.string()),
  risks: z.array(z.string()),
  focus: z.array(z.string()),
});
export type BriefDropped = z.infer<typeof BriefDropped>;

/** GET /pulls/:id/brief response shape (AC-23: 0 LLM calls). */
export const BriefPage = z.object({
  status: BriefStatus,
  reason: z.string().nullish(),
  brief: PrBrief.nullable(),
  provenance: BriefProvenance.nullable(),
  /** The PR's CURRENT head sha — compared against `provenance.head_sha` to
   *  decide `earlier_state`/`possibly_stale` client-side displays, and used
   *  as the AC-39 fallback-link pin when `provenance` is absent. */
  current_head_sha: z.string(),
  /** AC-25/AC-30: names what moved (e.g. "head sha", "repository index",
   *  "PR intent") — empty when nothing is stale. */
  stale_markers: z.array(z.string()),
});
export type BriefPage = z.infer<typeof BriefPage>;

/** POST /pulls/:id/brief/generate response shape — the same envelope plus
 *  what THIS generation's grounding dropped (null when nothing was dropped,
 *  or the call never reached grounding — e.g. `refused`/`generating`). */
export const BriefGenerateResult = BriefPage.extend({
  dropped: BriefDropped.nullish(),
});
export type BriefGenerateResult = z.infer<typeof BriefGenerateResult>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'tests', 'docs', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;
