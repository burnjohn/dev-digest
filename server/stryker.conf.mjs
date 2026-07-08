/**
 * Stryker Mutator config — manual, on-demand mutation testing for ONE
 * source file at a time (course exercise: "how good are the tests for THIS
 * file", not a permanent CI gate — never wired into any workflow/hook).
 *
 * Usage: always pass `--mutate` on the CLI to pick the target file for this
 * run — the `mutate` array below is only the fallback used if you forget to:
 *   pnpm mutate --mutate "src/modules/skills/eval-scoring.ts"
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  tempDirName: '.stryker-tmp',
  // `clones/` (gitignored — a local repo-intel/blast-radius working-copy
  // cache under server/) contains a Windows directory JUNCTION
  // (`clones/felkost/dev-digest/docs`). Stryker's sandbox-copy calls
  // `fs.copyFile` on every path it walks, and Windows' copyFile cannot
  // handle a reparse point — it fails with EPERM before gitignore filtering
  // ever gets a chance to skip it. Exclude it explicitly rather than relying
  // on .gitignore alone. (`files` is deprecated in this Stryker version —
  // `ignorePatterns` is the current key.)
  ignorePatterns: ['clones/**'],
  // Fallback target if --mutate is omitted — small, pure, fast (no DB/LLM
  // I/O), so an accidental bare `pnpm mutate` never turns into an hours-long
  // whole-repo run.
  mutate: ['src/modules/skills/eval-scoring.ts'],
};
