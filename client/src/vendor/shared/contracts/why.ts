import { z } from 'zod';

/**
 * §12 — git-why (`GET /pulls/:id/why?file&line`).
 *
 * A `WhyTimeline` answers "why does this line exist?" by walking git
 * blame/log (via `container.git`) for a file/line and reconstructing the
 * chain of commits — and, where the message references it, the PRs — that
 * shaped that line. Rendered as the `WhyTimeline` drawer (keyboard `w`).
 *
 * Owned by A3. Added as a NEW contract file; the barrel is wired by the
 * orchestrator (export * from './contracts/why.js').
 */

export const WhyEvent = z.object({
  /** Commit SHA (short or full). */
  sha: z.string(),
  /** First line of the commit message. */
  summary: z.string(),
  author: z.string(),
  /** ISO date string. */
  date: z.string(),
  /** PR number parsed from the commit message (e.g. "(#123)"), if any. */
  pr_number: z.number().int().nullish(),
  /** True for the blame head (the commit that last touched the line). */
  is_blame_head: z.boolean().default(false),
});
export type WhyEvent = z.infer<typeof WhyEvent>;

export const WhyTimeline = z.object({
  file: z.string(),
  line: z.number().int(),
  /** The commit that currently owns the line (from blame), if resolvable. */
  blame: WhyEvent.nullish(),
  /** Chronological-ish history of commits that shaped the file/line, newest first. */
  events: z.array(WhyEvent),
  summary: z.string(),
});
export type WhyTimeline = z.infer<typeof WhyTimeline>;
