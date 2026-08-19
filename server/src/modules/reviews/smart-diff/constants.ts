/**
 * Smart Diff — classifier constants (patterns + thresholds).
 *
 * Deliberately deterministic (glob-style patterns, no LLM call): Smart Diff
 * groups files by ROLE from their path alone, combined with already-persisted
 * `pr_files` stats and the latest review's findings. See
 * `server/src/modules/reviews/smart-diff/classifier.ts` for the pure function
 * that consumes these.
 */

/**
 * `boilerplate` — generated/vendored/derived files. Highest priority: a lock
 * file living under a nested "dist" directory is still boilerplate, not core.
 *
 * The leading double-star (glob "match any depth") on the directory patterns
 * below is deliberate, not a copy of a literal repo-root-only convention:
 * monorepos commonly nest "dist", "build", and "__snapshots__" under each
 * package, so anchoring only at the repo root would silently reclassify most
 * of them as `core`.
 */
export const BOILERPLATE_PATTERNS: readonly string[] = [
  '*.lock',
  'pnpm-lock.yaml',
  'package-lock.json',
  '**/dist/**',
  '**/build/**',
  '**/*.min.*',
  '**/__snapshots__/**',
  '*.snap',
  '**/*.generated.*',
];

/**
 * `wiring` — config/plumbing that connects modules but rarely carries business
 * logic. Checked after `boilerplate`, before the `core` fallback.
 */
export const WIRING_PATTERNS: readonly string[] = [
  '*.config.*',
  // Bare `config.ts`/`config.js` (no `.config.` infix) is the same plumbing
  // role — e.g. `src/config.ts` reading `process.env.*` — just named the
  // other way round from `vite.config.ts`.
  'config.*',
  'tsconfig*.json',
  '.github/**',
  'index.ts',
  '*.d.ts',
];

/**
 * `split_suggestion` thresholds — when a PR is large enough that "should this
 * be two PRs?" is worth surfacing. Both are deliberately generous (few
 * false positives) since this is a suggestion, not a gate:
 *
 * - `TOO_BIG_TOTAL_LINES` (500): the PR list already buckets diff size into
 *   S/M/L (`client/src/app/repos/[repoId]/pulls/constants.ts`, `L` starts at
 *   400 changed lines). 500 sits comfortably inside the existing "L" bucket
 *   rather than inventing a new size scale, while leaving headroom so a
 *   PR that's merely L-sized doesn't also get flagged "too big to review".
 * - `TOO_BIG_CORE_FILES` (8): once a PR touches more than a handful of `core`
 *   files, a single "split it" suggestion is more useful than a wall of
 *   groups — wiring/boilerplate files don't count toward this, since a PR
 *   that touches 20 config files but 2 core files is not the "hard to
 *   review" shape this threshold is meant to catch.
 */
export const TOO_BIG_TOTAL_LINES = 500;
export const TOO_BIG_CORE_FILES = 8;
