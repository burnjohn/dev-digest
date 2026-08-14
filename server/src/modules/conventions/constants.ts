/** Constants for the conventions module. */

/** How many rank-driven source files to sample per extraction run. */
export const SAMPLE_FILE_COUNT = 12;

/**
 * Config filenames looked for at the clone root — read directly off disk, no
 * model call (task requirement: config sampling is "повністю кодом, без
 * моделі"). Globs are resolved against the clone root only, one level deep.
 */
export const CONFIG_FILE_GLOBS = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  'tsconfig.json',
  'tsconfig.base.json',
  '.prettierrc',
  '.prettierrc.js',
  '.prettierrc.json',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  'prettier.config.js',
  'prettier.config.mjs',
] as const;

/** Per-file cap when reading source into the prompt — bounds prompt size across ~12 files + configs. */
export const MAX_FILE_CHARS = 6000;

/** Passed as `schemaName` to `completeStructured` (shows up in provider traces/logs). */
export const SCHEMA_NAME = 'ConventionCandidates';

/** Retries the LLM call gets on a schema-validation failure (parse-with-repair). */
export const EXTRACTION_MAX_RETRIES = 2;
