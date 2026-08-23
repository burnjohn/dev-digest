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

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
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
/**
 * Smart Diff — the reviewer-ordered view of a PR's changed files. Computed on
 * READ from the cached `pr_files` plus the persisted review findings, and
 * persisted nowhere. There is deliberately NO model call anywhere on this path.
 *
 * Five things this shape is otherwise read wrong:
 *
 * (a) `SmartDiffFileFinding.line` is a NEW-file line number — it comes from
 *     `Finding.start_line`. `0` means "no usable line": the finding is real but
 *     could not be placed on a rendered diff line (truncated context, outdated
 *     line, or a file GitHub gave us no patch for).
 * (b) `finding_lines` is DERIVED from `findings` — the sorted unique set of
 *     their `line` values — and is kept only for backwards compatibility. Never
 *     populate it independently; the two must not be able to disagree.
 * (c) `pseudocode_summary` is an UNBUILT placeholder for future work. Nothing
 *     writes it, nothing reads it, nothing renders it. Filling it would take a
 *     model call, which the zero-token guarantee on this endpoint forbids.
 *     Leave it `.nullish()` — never `.default(null)`.
 * (d) `SmartDiffFileFinding.id` is RUN-SCOPED. A re-run reporting the same issue
 *     mints a NEW id and the deduped winner flips to it, so an id the client
 *     cached can still RESOLVE — to the wrong finding, silently. That is why
 *     this response carries no `generated_at`, ETag or version field: a
 *     freshness stamp would imply a server-side cache that does not exist. The
 *     client is what has to invalidate.
 * (e) `default_open` is a FILE flag. There is deliberately no group-level
 *     equivalent — a group header is a heading, not a control.
 */
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

/** One finding placed on one line of one file. See (a) and (d) above. */
export const SmartDiffFileFinding = z.object({
  id: z.string(),
  line: z.number().int(),
  severity: Severity,
});
export type SmartDiffFileFinding = z.infer<typeof SmartDiffFileFinding>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  /** additions + deletions, precomputed so no consumer re-adds them. */
  changed_lines: z.number().int(),
  /** changed_lines > LARGE_FILE_LINES — the file is flagged as a big read. */
  large: z.boolean(),
  /** false when GitHub omitted the patch (too large, or binary). */
  has_patch: z.boolean(),
  /**
   * The ONLY collapse flag in this contract. `false` for every `boilerplate`
   * file, findings or no findings; for `core` and `wiring`, `true` iff the file
   * has at least one finding. Decided on the server so the UI cannot re-derive
   * it differently.
   */
  default_open: z.boolean(),
  findings: z.array(SmartDiffFileFinding),
  /** Derived from `findings` — see (b) above. */
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  /** files.length, so a group header needs no client-side arithmetic. */
  file_count: z.number().int(),
  files: z.array(SmartDiffFile),
  // NO `default_open` here, deliberately: groups never collapse — see (e).
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  /** Always length 3, always ordered: core, wiring, boilerplate. */
  groups: z.array(SmartDiffGroup),
  total_files: z.number().int(),
  /** Sum of changed_lines over every file — hoisted for the header. */
  total_lines: z.number().int(),
  /** Findings whose `file` is not among the PR's changed files. */
  unmatched_finding_count: z.number().int(),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    /** Always `[]` — the flag is computed, the proposal is not built. */
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
