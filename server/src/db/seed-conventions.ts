import type { ConventionCategory } from '@devdigest/shared';

/**
 * Seed convention candidates for the demo repo (mirrors `seed-skills.ts`).
 *
 * These exist so the Conventions page has real content — cards, categories, a
 * confidence meter, a working accept/reject/edit flow and a merged skill body —
 * with NO API key and NO indexed clone. That also makes the page's journey
 * deterministic: a real extraction depends on a model's output, a seeded row does
 * not.
 *
 * Each row is written exactly the way `extract` writes one, so seeded state is
 * indistinguishable from scanned state:
 *  - `evidence_start_line`/`end_line` are a real range, as grounding returns;
 *  - `supportCount === supportFiles.length` (the service derives one from the
 *    other — a row where they disagree could never have been produced);
 *  - every row has a real DENOMINATOR (`violationCount`), because a scan that
 *    could not measure one would have been capped and marked, and a seeded row
 *    that skipped it would be the one card on the page whose meter means
 *    something different from the rest;
 *  - `confidence` is not stored here at all — `seed.ts` runs the same
 *    `scoreConfidence` the service does, so the meter cannot drift from the
 *    scorer the way a hardcoded number silently did;
 *  - all rows land as `pending` — the user's triage is the demo.
 *
 * Paths are the demo repo's `pr_files` paths from `seed.ts`. There is no clone
 * behind `acme/payments-api`, so nothing here can be re-grounded — which is
 * exactly why a re-scan REPLACES pending rows instead of merging into them.
 */

export interface SeedConvention {
  category: ConventionCategory;
  rule: string;
  rationale: string;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  supportFiles: string[];
  /**
   * Conforming SITES, in the unit `COUNTING_STRATEGY[category]` implies — equal to
   * `supportFiles.length` for the text/paths strategies, and a declaration count
   * for `naming`, where several symbols can share a file.
   */
  followCount: number;
  /** Sites that break the rule. The denominator half of the conformance ratio. */
  violationCount: number;
  /** What the model claimed. Only ~15% of the final score. */
  modelConfidence: number;
}

export const SEED_CONVENTIONS: SeedConvention[] = [
  {
    category: 'async',
    rule: 'Always use async/await instead of .then() chains',
    rationale:
      'Every data-access call in the sampled handlers is awaited; no .then() chain survives in application code.',
    evidencePath: 'src/api/users.ts',
    evidenceSnippet:
      'const user = await db.users.find(id);\nconst posts = await db.posts.findMany({ userId });',
    evidenceStartLine: 23,
    evidenceEndLine: 31,
    supportFiles: [
      'src/api/users.ts',
      'src/api/public/webhooks.ts',
      'src/api/public/index.ts',
      'src/middleware/ratelimit.ts',
      'src/pricing/discount.ts',
      'src/lib/redis.ts',
    ],
    followCount: 6,
    violationCount: 1,
    modelConfidence: 0.91,
  },
  {
    category: 'error_handling',
    rule: 'All public route handlers return typed Result<T, ApiError>',
    rationale:
      'Public handlers never throw to the framework — they return a Result the router serializes, so the error shape is uniform.',
    evidencePath: 'src/api/public/index.ts',
    evidenceSnippet: 'function handler(): Result<Item[], ApiError> {\n  return ok(items);\n}',
    evidenceStartLine: 14,
    evidenceEndLine: 20,
    supportFiles: [
      'src/api/public/index.ts',
      'src/api/public/webhooks.ts',
      'src/api/users.ts',
      'src/pricing/discount.ts',
    ],
    followCount: 4,
    violationCount: 1,
    modelConfidence: 0.78,
  },
  {
    category: 'structure',
    rule: 'Redis access goes through the src/lib/redis.ts singleton',
    rationale:
      'One module constructs the client and exports it; no other file calls `new Redis(...)`.',
    evidencePath: 'src/lib/redis.ts',
    evidenceSnippet: 'export const redis = new Redis(config.redisUrl);',
    evidenceStartLine: 1,
    evidenceEndLine: 9,
    supportFiles: [
      'src/lib/redis.ts',
      'src/middleware/ratelimit.ts',
      'src/api/users.ts',
      'src/api/public/webhooks.ts',
      'src/api/public/index.ts',
      'src/config.ts',
    ],
    followCount: 6,
    violationCount: 1,
    modelConfidence: 0.85,
  },
  {
    // Deliberately the weakest of the four: 3 supporters, a visibly lower meter.
    // The page is not honest if every seeded card reads 85%+.
    category: 'naming',
    rule: 'Middleware factories are named for their concern and exported from src/middleware/<concern>.ts',
    rationale:
      'Each middleware file exports one factory whose name matches the file, so the router reads as a list of concerns.',
    evidencePath: 'src/middleware/ratelimit.ts',
    evidenceSnippet: 'export function rateLimit(opts: RateLimitOptions): Middleware {',
    evidenceStartLine: 25,
    evidenceEndLine: 25,
    supportFiles: [
      'src/middleware/ratelimit.ts',
      'src/api/public/index.ts',
      'src/config.ts',
    ],
    followCount: 5,
    violationCount: 2,
    modelConfidence: 0.64,
  },
];
