/**
 * Conventions Extractor — tuning knobs. Sampling is deliberately CODE-ONLY and
 * deterministic: the model never chooses what it reads, so two scans of the
 * same commit see the same bytes and a scan costs a predictable number of
 * tokens.
 */

/** How many rank-ordered source files go into the sample (repo-intel picks them). */
export const TOP_CODE_SAMPLES = 12;

/**
 * Config files worth their tokens: they state conventions declaratively, so a
 * rule derived from one is checkable and rarely hallucinated. Read in this
 * order; missing ones are skipped silently (most repos have a handful).
 */
export const CONFIG_SAMPLE_PATHS = [
  'package.json',
  'tsconfig.json',
  'eslint.config.mjs',
  'eslint.config.js',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.prettierrc',
  '.prettierrc.json',
  '.editorconfig',
  'biome.json',
  'CONTRIBUTING.md',
  'CLAUDE.md',
  'AGENTS.md',
] as const;

/** Per-file cap on what reaches the prompt. Beyond this a file is truncated. */
export const MAX_FILE_LINES = 220;
export const MAX_FILE_CHARS = 12_000;

/** Cap on the whole rendered sample, so a big repo cannot blow the context. */
export const MAX_SAMPLE_CHARS = 90_000;

/** How many candidates we ask for. More than this is noise, not coverage. */
export const MAX_CANDIDATES = 12;

/** Evidence gate — a snippet shorter than this is not identifying enough. */
export const MIN_SNIPPET_CHARS = 8;

/** How many lines of real file content we keep as the displayed evidence. */
export const MAX_SNIPPET_LINES = 8;

/** Model call bounds. Extraction is one call; a retry is the provider's own. */
export const EXTRACT_TEMPERATURE = 0.1;
export const EXTRACT_MAX_TOKENS = 4_000;
export const EXTRACT_TIMEOUT_MS = 120_000;
