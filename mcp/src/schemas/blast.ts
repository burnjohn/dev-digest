import { z } from 'zod';

/**
 * `get_blast_radius(repo, pr)` (ring M0) — value schemas for the WIRED tool
 * (docs/plans/06-blast-radius.md, T3). This used to be a deliberate stub
 * (decision D8, `docs/plans/05-mcp-server.md` §5.8: "exposing it is the
 * course homework") that always returned `isError: true` with
 * `{implemented: false, retry: false, reason, use_instead}` and made no HTTP
 * call. The owner has now explicitly commissioned that exercise — this file
 * is that wiring, not an accidental one; see `tools/get-blast-radius.ts`'s
 * own header for the fuller provenance note.
 *
 * `GetBlastRadiusOutput` is a NARROW PROJECTION of the server's
 * `BlastRadiusResponse` (`server/src/vendor/shared/contracts/blast-api.ts`),
 * never the wire contract itself (`mcp/AGENTS.md` §4: "MCP output schemas
 * are narrow projections, never domain contracts"). The actual
 * narrowing/capping logic lives in `shaping/blast.ts` (M2) — this file only
 * declares the SHAPE that projection must produce. Every field here is
 * declared against this package's own zod (`^3.25`), independent of the
 * shared contract's zod (`^3.24.1`), per `mcp/AGENTS.md` §3.
 *
 * All output fields are optional — the resolution-failure branch in
 * `tools/get-blast-radius.ts` returns `{}` (never a zero-totals shape, which
 * would misreport "could not resolve the PR" as "this PR touches nothing" —
 * the same fail-open guard `GetFindingsOutput` documents). None is
 * `.default()`'d: under `strict: true` structured output a default would
 * mask a genuinely-missing field (`server/INSIGHTS.md`, 2026-08-17).
 */

export const BlastRadiusStatus = z.enum(['ok', 'partial', 'degraded']);
export type BlastRadiusStatusShape = z.infer<typeof BlastRadiusStatus>;

export const BlastChipKind = z.enum(['endpoint', 'cron']);
export type BlastChipKindShape = z.infer<typeof BlastChipKind>;

/** The mockup's count strip, carried through unabridged — four integers cost
 *  almost nothing and are the one thing worth showing even when everything
 *  else is capped away. */
export const BlastTotalsSchema = z.object({
  symbols: z.number().int(),
  callers: z.number().int(),
  endpoints: z.number().int(),
  crons: z.number().int(),
});
export type BlastTotalsShape = z.infer<typeof BlastTotalsSchema>;

/** One changed symbol, narrowed to the three fields worth a model's tokens —
 *  never the per-caller `file:line` rows or `rank` the server's
 *  `BlastSymbolImpact` also carries (see `shaping/blast.ts`'s doc comment
 *  for the full drop list). */
export const BlastSymbolSummarySchema = z.object({
  symbol: z.string(),
  file: z.string(),
  caller_count: z.number().int(),
});
export type BlastSymbolSummaryShape = z.infer<typeof BlastSymbolSummarySchema>;

/** One endpoint/cron chip, flattened out of every symbol's `chips[]` and
 *  deduplicated — never attributed back to a specific symbol or file (that
 *  attribution is exactly what `file_impact`/per-symbol chips cost, and this
 *  projection drops it on purpose). */
export const BlastChipSummarySchema = z.object({
  label: z.string(),
  kind: BlastChipKind,
});
export type BlastChipSummaryShape = z.infer<typeof BlastChipSummarySchema>;

export const GetBlastRadiusInput = {
  repo: z.string().min(1).describe('"owner/name" of the imported repo'),
  pr: z.number().int().positive().describe('the pull request number'),
};

export const GetBlastRadiusOutput = {
  status: BlastRadiusStatus.optional(),
  /** Non-empty whenever `status !== 'ok'` — always present alongside `status`. */
  status_reason: z.string().optional(),
  totals: BlastTotalsSchema.optional(),
  /** Capped at `MAX_BLAST_SYMBOLS` (`shaping/blast.ts`), most-called first. */
  symbols: z.array(BlastSymbolSummarySchema).optional(),
  /** Capped and deduplicated at `MAX_BLAST_CHIPS` (`shaping/blast.ts`). */
  chips: z.array(BlastChipSummarySchema).optional(),
  /** `true` when either cap above actually dropped a row — the model must
   *  never read a capped list as exhaustive. */
  truncated: z.boolean().optional(),
} satisfies z.ZodRawShape;

export type GetBlastRadiusInputArgs = z.infer<z.ZodObject<typeof GetBlastRadiusInput>>;
export type GetBlastRadiusOutputResult = z.infer<z.ZodObject<typeof GetBlastRadiusOutput>>;
