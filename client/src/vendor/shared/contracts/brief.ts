import { z } from 'zod';
import { Severity } from './findings.js';

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

/**
 * Caller classification — a deterministic reviewer signal derived from the file
 * path + repo-intel rank / endpoint reachability (NO model call):
 *   business    — reaches an HTTP endpoint or cron, or a high-rank (widely
 *                 depended-on) file: the change touches real product surface.
 *   test        — the caller is a test/spec/mock file.
 *   boilerplate — config / migration / generated / type-decl noise.
 *   normal      — ordinary application code.
 */
export const CallerRole = z.enum(['business', 'test', 'boilerplate', 'normal']);
export type CallerRole = z.infer<typeof CallerRole>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
  role: CallerRole.default('normal'),
  /** Call site is inside a loop (for/while/.forEach/.map/…) → amplified
      performance impact. Detected from the caller's source, no model call. */
  in_loop: z.boolean().default(false),
  /** Call site is NOT wrapped in try/catch → a stability risk when the changed
      symbol can throw (see DownstreamImpact.may_throw). */
  unguarded: z.boolean().default(false),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  /** The symbol's declaring file (for finding cross-ref + jump-to-code). */
  file: z.string().default(''),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
  /** Worst severity of EXISTING agent findings on this changed code (null = none). */
  finding_severity: Severity.nullable().default(null),
  /** How many agent findings land on this changed code. */
  finding_count: z.number().int().default(0),
  /** The changed code adds a `throw` in this PR → callers without a try/catch
      (see BlastCaller.unguarded) are a stability risk. Derived from the diff. */
  may_throw: z.boolean().default(false),
  /** The symbol's signature/interface was edited in this PR (params/return/shape).
      When it also reaches an endpoint this is a breaking-integration risk.
      Derived from the diff (a declaration line for the symbol changed). */
  breaking: z.boolean().default(false),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

/** A prior PR that also touched one of this PR's changed files. */
export const BlastRelatedPr = z.object({
  id: z.string(),
  number: z.number().int(),
  title: z.string(),
});
export type BlastRelatedPr = z.infer<typeof BlastRelatedPr>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  /** Changed top-level symbols with NO external callers — possibly dead/unused. */
  dead_symbols: z.array(ChangedSymbol).default([]),
  /** Prior PRs that touched the same files (recency context). */
  related_prs: z.array(BlastRelatedPr).default([]),
  /** True when at least one agent review existed to cross-reference findings. */
  findings_available: z.boolean().default(false),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

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
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
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

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;
