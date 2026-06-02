/**
 * A2 — review module constants (extracted from service.ts; no behaviour change).
 */

/** Diffs bigger than this (changed lines) trigger map-reduce per file. */
export const FILE_MAP_THRESHOLD_LINES = 400;

/** Verdict severity ordering — higher wins when reducing per-file reviews. */
export const VERDICT_RANK: Record<string, number> = {
  request_changes: 2,
  comment: 1,
  approve: 0,
};

/** Smart Diff "too big" thresholds (split nudger). */
export const SPLIT_TOO_BIG_LINES = 400;
export const SPLIT_TOO_BIG_FILES = 12;

/** Smart Diff role order used for grouping + proposed splits. */
export const SMART_DIFF_ROLES = ['core', 'wiring', 'boilerplate'] as const;

/** File-classification heuristics (path → smart-diff role). */
export const BOILERPLATE_RE =
  /(package\.json|package-lock|pnpm-lock|yarn\.lock|tsconfig|\.lock$|\.snap$|\.md$|license|\.gitignore|dist\/|\.generated\.|migrations?\/)/;
export const WIRING_RE =
  /(index\.(ts|js)|routes?\.|config\.|\.module\.|setup\.|wiring|register|barrel|exports?\.)/;

/** Defaults used when deriving intent without a concrete agent. */
export const DEFAULT_INTENT_PROVIDER = 'openai';
export const DEFAULT_INTENT_MODEL = 'gpt-4.1';

/** System prompt for the intent-derivation pass. */
export const INTENT_SYSTEM_PROMPT =
  'You derive the INTENT of a pull request: a one-sentence intent, a list of in-scope concerns, and a list of out-of-scope concerns (files/areas a reviewer should NOT flag). Be concise.';

/** Max findings requested per review (task line). */
export const MAX_FINDINGS_PER_REVIEW = 5;

/** Memory retrieval tuning for a review run. */
export const MEMORY_TOP_K = 5;

/** Max chars of the PR title+body used to build the memory query. */
export const MEMORY_QUERY_MAX_CHARS = 500;

/** Cap on project-context spec chunks pulled per run. */
export const SPEC_CHUNK_LIMIT = 6;

/** Structured-completion retry budgets. */
export const REVIEW_MAX_RETRIES = 2;
export const INTENT_MAX_RETRIES = 1;
