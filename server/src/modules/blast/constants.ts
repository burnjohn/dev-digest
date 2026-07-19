/**
 * A3 — blast-radius module constants (extracted from service.ts; no behaviour change).
 */

/** Chunk size for batched symbol/reference inserts (stay under param limits). */
export const INSERT_CHUNK_SIZE = 500;

/** Max callers shown per changed symbol (highest file-rank kept). */
export const CALLER_CAP = 20;

/** Test/spec/mock files — a caller here is a `test` role (lower prod impact). */
export const TEST_FILE_RE =
  /(\.(test|spec)\.[cm]?[jt]sx?$)|(^|\/)(tests?|__tests__|__mocks__|e2e|cypress)\//i;

/** Config / migration / generated / type-decl noise — a `boilerplate` caller. */
export const BOILERPLATE_FILE_RE =
  /(\.d\.ts$)|(\.(config|setup|conf)\.[cm]?[jt]s$)|(^|\/)(migrations?|generated|dist|build|vendor|fixtures?|__generated__)\//i;

/**
 * File rank at/above which a (non-test, non-boilerplate) caller counts as
 * `business` even without a reachable endpoint/cron — a widely depended-on file.
 * Rank is repo-intel's inbound-reference count; 40 keeps this to genuine hubs.
 */
export const BUSINESS_RANK_THRESHOLD = 40;

/** Max prior PRs listed in "Prior PRs touching these files". */
export const RELATED_PR_CAP = 5;

/** How many lines above a call site to scan for an enclosing loop/try. */
export const CALL_SITE_SCAN_LINES = 200;

/** Summary strings for the degenerate (nothing-to-analyze) cases. */
export const NO_FILES_SUMMARY =
  'No changed files recorded for this PR yet — open the PR detail to import its files.';
export const NOT_CLONED_SUMMARY =
  'Repo is not cloned yet — clone the repo to compute the blast radius.';
export const NO_SYMBOLS_SUMMARY = 'No top-level symbols changed in this PR.';
