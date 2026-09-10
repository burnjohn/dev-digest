/**
 * Path/pattern constants for the Smart Diff classifier (`smart-diff.ts`).
 * Pure data — tune thresholds and patterns here without touching the
 * classification logic itself. Checked most-specific-first: boilerplate,
 * then docs, then tests, then wiring, else core (the default).
 */

export const LOCK_FILE_PATTERNS: RegExp[] = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.ya?ml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)go\.sum$/,
];

export const BOILERPLATE_PATH_PATTERNS: RegExp[] = [
  ...LOCK_FILE_PATTERNS,
  /(^|\/)package\.json$/,
  /(^|\/)(dist|build|out|coverage|\.next)\//,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.min\.(js|css)$/,
  /\.map$/,
];

/** Documentation & specifications — prose, not code. Matched by extension
 *  or by living in a docs/specs directory. Checked before tests so that
 *  `test/README.md` lands in docs. */
export const DOCS_PATH_PATTERNS: RegExp[] = [
  /\.(md|mdx|markdown|rst|adoc|txt)$/i,
  /(^|\/)(docs?|specs?|adrs?|rfcs?|plans?)\//,
  /(^|\/)\.devdigest\/specs\//,
  /(^|\/)(README|CHANGELOG|CONTRIBUTING|LICENSE|CODEOWNERS)(\.[a-z]+)?$/,
];

/** Test code — unit/integration/e2e specs, fixtures, mocks, and test dirs.
 *  `*.spec.*` here means a test file (JS/TS convention), not a spec document
 *  — those are caught by DOCS_PATH_PATTERNS first. */
export const TEST_PATH_PATTERNS: RegExp[] = [
  /\.(test|spec|it\.test)\.[cm]?[jt]sx?$/,
  /(^|\/)__(tests|mocks|fixtures)__\//,
  /(^|\/)(test|tests|e2e|spec|specs|fixtures|cypress|playwright)\/.*\.[cm]?[jt]sx?$/,
  /(^|\/)(vitest|jest|playwright|cypress)\.setup\.[cm]?[jt]s$/,
];

export const WIRING_BASENAME_PATTERNS: RegExp[] = [
  /^index\.[cm]?[jt]sx?$/,
  /^server\.[cm]?[jt]s$/,
  /^config\.[cm]?[jt]s$/,
  /^container\.[cm]?[jt]s$/,
  /^app\.[cm]?[jt]s$/,
  /^bootstrap\.[cm]?[jt]s$/,
  /^main\.[cm]?[jt]s$/,
  /^setup\.[cm]?[jt]s$/,
];

export const WIRING_PATH_PATTERNS: RegExp[] = [
  /\.config\.[cm]?[jt]s$/,
  /(^|\/)tsconfig.*\.json$/,
  /(^|\/)\.github\/workflows\//,
  /(^|\/)docker-compose.*\.ya?ml$/,
  /(^|\/)Dockerfile/,
  /(^|\/)\.env(\.|$)/,
];

/** Above this many total changed lines (additions+deletions across all
 *  files), the PR is flagged as a split candidate. */
export const SPLIT_SUGGESTION_LINE_THRESHOLD = 400;
