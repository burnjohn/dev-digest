/**
 * A3 — blast-radius module constants (extracted from service.ts; no behaviour change).
 */

/** Chunk size for batched symbol/reference inserts (stay under param limits). */
export const INSERT_CHUNK_SIZE = 500;

/** Summary strings for the degenerate (nothing-to-analyze) cases. */
export const NO_FILES_SUMMARY =
  'No changed files recorded for this PR yet — open the PR detail to import its files.';
export const NOT_CLONED_SUMMARY =
  'Repo is not cloned yet — clone the repo to compute the blast radius.';
export const NO_SYMBOLS_SUMMARY = 'No top-level symbols changed in this PR.';
