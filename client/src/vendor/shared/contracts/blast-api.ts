import { z } from 'zod';

/**
 * Blast radius API — the wire contract for `GET /pulls/:id/blast`
 * (docs/plans/06-blast-radius.md).
 *
 * "What else could this diff touch?" — the symbols declared in a PR's changed files, who calls
 * them, and which HTTP endpoints / cron jobs may depend on the changed code. Answered entirely
 * from facts the `repo-intel` index already holds; no model call in the core path.
 *
 * WAVE-0 COMPLETENESS (§4 of the plan): this file is written once, for the WHOLE plan, not just
 * the first task that lands. `file_impact`, `prior_prs` and `narrative` are declared here even
 * though wave 1 (T2) always emits them empty/null — T5 (wave 2) fills `file_impact` and
 * `prior_prs`, T9 (wave 4) fills `narrative` behind a flag. Once this file exists on disk it is
 * an *existing file under `vendor/shared/contracts/**`*, i.e. Tier A, so no later task in this
 * plan may add a field to it — every field any wave needs is declared now.
 *
 * NAME COLLISION NOTE: `contracts/brief.ts` already exports `BlastRadius`, `ChangedSymbol`,
 * `BlastCaller` and `DownstreamImpact` for the legacy PR-brief shape (unused by this feature,
 * Tier A, never removed or amended). `vendor/shared/index.ts` is a flat `export *` barrel, so
 * every name below deliberately avoids those four — `BlastRadiusResponse` rather than
 * `BlastRadius`, `BlastSymbolImpact`/`BlastFileImpact` rather than `ChangedSymbol`/
 * `DownstreamImpact`, `BlastCallerRef` rather than `BlastCaller`.
 *
 * NO ARRAY MEANS "UNKNOWN": availability is carried only by the explicit `coverage` booleans.
 * The route must never substitute `[]` for a fact it does not have — an empty array here is
 * always a genuine "there are none", never "we don't know".
 */

export const BlastStatus = z.enum(['ok', 'partial', 'degraded']);
export type BlastStatus = z.infer<typeof BlastStatus>;

export const BlastChipKind = z.enum(['endpoint', 'cron']);
export type BlastChipKind = z.infer<typeof BlastChipKind>;

export const BlastCoverage = z.object({
  callers_available: z.boolean(),
  endpoints_available: z.boolean(),
  crons_available: z.boolean(),
  imports_available: z.boolean(),
  prior_prs_available: z.boolean(),
  files_indexed: z.number().int(),
  files_skipped: z.number().int(),
  /**
   * Intended to be `true` once a repo's index hit `MAX_INDEXED_FILES` (5000) and the
   * results are therefore necessarily partial.
   *
   * **Currently ALWAYS `false`, and that is not yet a measurement — do not trust it.**
   * The signal does not survive the indexer: `repo-intel/pipeline/walk.ts` truncates to
   * the first 5000 relpaths ALPHABETICALLY and records `stats.bounded`, but nothing ever
   * reads `bounded` — it does not set `status: 'partial'`, it does not feed
   * `files_skipped` (that counts individually oversized files, a different thing), and
   * the `'repo_too_large'` member of `DegradedReason` is declared but never assigned.
   * So a repo over 5000 files reports `status: 'ok'` with this field `false`.
   *
   * `blast/` cannot fix that from the outside: the honest signal has to come from
   * `IndexState`, and editing `repo-intel` is out of scope by owner decision (plan 06,
   * D4). Reading this field as "the index is complete" is therefore wrong today. It is
   * kept on the wire so the fix is a one-line change here rather than a contract edit,
   * and so this limitation has somewhere to be written down.
   *
   * Before relying on it: make `walk.stats.bounded` set `status: 'partial'` +
   * `degradedReason: 'repo_too_large'`, surface it on `IndexState`, then replace the
   * hardcoded `false` in `blast/helpers.ts`.
   */
  index_truncated: z.boolean(),
});
export type BlastCoverage = z.infer<typeof BlastCoverage>;

export const BlastCallerRef = z.object({
  file: z.string(),
  symbol: z.string(),
  line: z.number().int(),
  rank: z.number(),
});
export type BlastCallerRef = z.infer<typeof BlastCallerRef>;

export const BlastChip = z.object({
  /** e.g. "GET /repos/:id" for an endpoint, or the raw cron text for a cron. */
  label: z.string(),
  kind: BlastChipKind,
  file: z.string(),
});
export type BlastChip = z.infer<typeof BlastChip>;

export const BlastSymbolImpact = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
  /** Excludes the declaring file, capped at 20, ordered by `rank` desc (REQ-3). */
  callers: z.array(BlastCallerRef),
  /** Pre-cap count, so a truncated `callers` list can still show "N callers" honestly. */
  caller_count: z.number().int(),
  chips: z.array(BlastChip),
});
export type BlastSymbolImpact = z.infer<typeof BlastSymbolImpact>;

/**
 * A file reached by the depth<=2 reverse-import walk from a changed file (REQ-9).
 *
 * BOUND (A1): consumed by exactly two things — the `totals` count strip and the Graph view.
 * It is NEVER rendered as rows inside the Tree; the Tree stays exactly symbol -> callers -> chips,
 * as mocked.
 */
export const BlastFileImpact = z.object({
  file: z.string(),
  depth: z.union([z.literal(1), z.literal(2)]),
  chips: z.array(BlastChip),
});
export type BlastFileImpact = z.infer<typeof BlastFileImpact>;

/**
 * A prior PR whose cached `pr_files` overlap this PR's changed files (REQ-10).
 *
 * BOUND (A2): `number` is the only identifier a consumer needs — the internal link is built as
 * `/repos/{repoId}/pulls/{number}`, and `repoId` is already a route param on the page that
 * renders this card. No repo identifier (id, full_name, or a github.com URL) is carried here on
 * purpose; adding one would let a consumer build an external link, which A2 forbids.
 */
export const BlastPriorPr = z.object({
  number: z.number().int(),
  title: z.string(),
  status: z.string(),
  overlap_count: z.number().int(),
  overlapping_files: z.array(z.string()),
  updated_at: z.string().nullable(),
});
export type BlastPriorPr = z.infer<typeof BlastPriorPr>;

/** The mockup's count strip. */
export const BlastTotals = z.object({
  symbols: z.number().int(),
  callers: z.number().int(),
  endpoints: z.number().int(),
  crons: z.number().int(),
});
export type BlastTotals = z.infer<typeof BlastTotals>;

export const BlastRadiusResponse = z.object({
  status: BlastStatus,
  /** A non-empty, human-readable sentence whenever `status !== 'ok'`. */
  status_reason: z.string(),
  coverage: BlastCoverage,
  changed_file_count: z.number().int(),
  totals: BlastTotals,
  symbols: z.array(BlastSymbolImpact),
  file_impact: z.array(BlastFileImpact),
  prior_prs: z.array(BlastPriorPr),
  /** D3: the one-paragraph LLM narration. `null` unless the narration flag is on (REQ-19/REQ-20). */
  narrative: z.string().nullable(),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;
