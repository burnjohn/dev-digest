import { z } from 'zod';
import { BlastRadius, PrHistory } from './brief.js';

/**
 * BlastResponse: live blast-radius endpoint contract.
 * Consumed by: client `useBlast` hook, MCP `get_blast_radius` tool, contract tests.
 */

// ---- Index state ----
export const BlastIndexInfo = z.object({
  status: z.enum(['full', 'partial', 'degraded', 'failed']),
  degraded: z.boolean(),
  reason: z.string().nullish(),          // DegradedReason when degraded
});
export type BlastIndexInfo = z.infer<typeof BlastIndexInfo>;

// ---- GitHub blob link ----
export const BlastLink = z.object({      // everything the client needs for GitHub blob URLs
  owner: z.string(),
  repo: z.string(),
  head_sha: z.string(),
});
export type BlastLink = z.infer<typeof BlastLink>;

// ---- Top-level response ----
export const BlastResponse = z.object({
  available: z.boolean(),                // false → render empty state
  blast: BlastRadius.nullable(),         // REUSE the existing shared shape the card already renders
  history: PrHistory,                    // real prior PRs (computed), not seed
  index: BlastIndexInfo,
  link: BlastLink.nullable(),
  truncated: z.record(z.string(), z.number()).optional(), // symbol → hidden caller count ("+N more")
  /** cron/job value → source file(s) that declare it (pure index data). Lets the
   *  UI label a cron badge by its file rather than the raw expression. */
  cron_files: z.record(z.string(), z.array(z.string())).optional(),
});
export type BlastResponse = z.infer<typeof BlastResponse>;
