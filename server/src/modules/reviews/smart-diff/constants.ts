import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Every threshold and every path pattern Smart Diff uses lives here — REQ-4.
 * No other file in `server/` or `client/` may declare a Smart Diff threshold
 * or classification regex. See `docs/plans/04-smart-diff.md` §9 "Where the
 * numbers come from" for the full citation table this file is a copy of.
 *
 * Classification (`classify.ts`) is PATH-ONLY, never content-based — see §5.2
 * / §11 D8. These patterns match a POSIX-style relative path (forward
 * slashes), case-sensitive.
 */

/**
 * GitHub auto-loads only the first 400 lines / 20 KB of a file's diff
 * (docs.github.com, repository limits); the Cisco/SmartBear inspection study
 * puts an effective review session at <=200-400 LOC. The two agree.
 */
export const LARGE_FILE_LINES = 400;

/**
 * Google `eng-practices`: "100 lines is usually a reasonable size for a CL,
 * and 1000 lines is usually too large."
 */
export const SPLIT_SUGGESTION_LINES = 1000;

/**
 * Every filename here classifies `boilerplate` no matter how deep it sits —
 * GitHub Linguist's `generated.rb` treats every one of these as machine
 * written and never worth a line-by-line read. `BOILERPLATE_PATTERNS` below
 * turns each into a "matches at any depth" pattern.
 */
export const LOCK_FILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
  'composer.lock',
  'Pipfile.lock',
  'gradlew',
  'gradlew.bat',
  'mvnw',
  'mvnw.cmd',
] as const;

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LOCK_FILE_PATTERNS: RegExp[] = LOCK_FILES.map(
  (name) => new RegExp(`(^|/)${escapeRegExp(name)}$`),
);

/**
 * Boilerplate wins over Wiring when both would match (§5.2): a generated file
 * that also looks like config (e.g. a vendored `next.config.js`) should be
 * skimmed, not reviewed as wiring.
 *
 * Sources, in order of the blocks below: GitHub Linguist `vendor.yml`
 * (vendored/third-party trees), `LOCK_FILE_PATTERNS` above, Linguist
 * `generated.rb` (mechanically produced, minified), this repo's own
 * generated MIRROR under `client/src/vendor/shared/**` (written by
 * `./scripts/sync-vendor.sh` — `server/src/vendor/shared/**`, the hand-written
 * source of truth for every contract in the repo, and `client/src/vendor/ui/**`,
 * the hand-maintained design system, are NOT boilerplate — REQ-30), Linguist
 * `documentation.yml` (prose, skim not review), and `package.json` (owner
 * decision, REQ-32 — not a Linguist rule, see the block below).
 */
export const BOILERPLATE_PATTERNS: RegExp[] = [
  // GitHub Linguist vendor.yml. The generic `vendor/` catch-all excludes this
  // repo's own `vendor/shared/**` and `vendor/ui/**` trees (REQ-30) — they are
  // re-classified below, in "this repo's own generated/vendored shapes", by a
  // narrower pattern that targets only the true generated mirror. Without this
  // lookahead the generic rule wins first and both trees stay `boilerplate`
  // regardless of what the narrower patterns say.
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)vendor\/(?!shared\/|ui\/)/,
  /(^|\/)bower_components\//,
  /(^|\/)Carthage\//,
  /(^|\/)gradle\/wrapper\//,
  /(^|\/)\.mvn\/wrapper\//,
  /(^|\/)packages\/[^/]+\.[^/]+\//, // NuGet packages/x.y/

  // Lock files — see LOCK_FILES above
  ...LOCK_FILE_PATTERNS,

  // GitHub Linguist generated.rb — mechanically produced, never hand-edited
  /(^|\/)\.designer\.cs$/,
  /(^|\/)Pods\//,
  /(\.|-)min\.(js|css)$/,

  // This repo's own generated/vendored shapes — only the SYNCED MIRROR under
  // client/src/vendor/shared/** is generated (REQ-30). server/src/vendor/shared/**
  // is the hand-written source of truth for every contract and classifies `core`;
  // client/src/vendor/ui/** is the hand-maintained design system and also
  // classifies `core` — ./scripts/sync-vendor.sh writes vendor/shared only.
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\.generated\./,
  /^client\/src\/vendor\/shared\//,
  /(^|\/)test-results\//,
  /(^|\/)clones\//,

  // GitHub Linguist documentation.yml — prose, not logic
  /(^|\/)[Dd]ocs?\//,
  /(^|\/)[Dd]ocumentation\//,
  /(^|\/)[Ee]xamples\//,
  /(^|\/)README(\.[^/]+)?$/,
  /(^|\/)LICEN[CS]E(\.[^/]+)?$/,

  // package.json — owner decision, 2026-08-22 (REQ-32). NOT a Linguist rule —
  // Linguist does not treat package.json as generated. `docs/mockups/smart-diff-mock.png`
  // groups the manifest with its lock file, so it is skimmed alongside it rather than
  // reviewed as wiring. Scoped to package.json only; no other manifest (Cargo.toml,
  // pyproject.toml, go.mod, composer.json, Gemfile) has mockup evidence for this move.
  /(^|\/)package\.json$/,
];

/**
 * Files that CONNECT code without carrying the change's substance (§5.2):
 * build/tool config, env files, CI definitions, barrels/entrypoints, route
 * registration, and framework file conventions. `package.json` is NOT here —
 * REQ-32 (owner decision, 2026-08-22) classifies the manifest `boilerplate`,
 * alongside its lock file, matching `docs/mockups/smart-diff-mock.png`.
 */
export const WIRING_PATTERNS: RegExp[] = [
  // Build & tool config
  /(^|\/)[^/]+\.config\.(ts|tsx|js|mjs|cjs)$/,
  /(^|\/)tsconfig(\.[^/]+)?\.json$/,
  /(^|\/)drizzle\.config\.[^/]+$/,
  /(^|\/)next\.config\.[^/]+$/,
  /(^|\/)vitest\.config\.[^/]+$/,
  /(^|\/)postcss\.config\.[^/]+$/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
  /(^|\/)Dockerfile[^/]*$/,

  // Env files
  /(^|\/)\.env(\.[^/]+)?$/,

  // CI definitions
  /(^|\/)\.github\//,
  /(^|\/)\.gitlab-ci\.ya?ml$/,

  // Barrels & entrypoints
  /(^|\/)index\.(ts|tsx|js|jsx)$/,
  /(^|\/)main\.[^/]+$/,
  /(^|\/)app\.ts$/,
  /(^|\/)server\.ts$/,

  // Route registration
  /(^|\/)routes?\.ts$/,
  /(^|\/)router\.tsx$/,

  // Framework file conventions
  /(^|\/)layout\.tsx$/,
  /(^|\/)middleware\.ts$/,
  /(^|\/)proxy\.ts$/,
];

/** Between-group ranking (§5.3) — fixed, always all three, always this order. */
export const ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/**
 * Roles whose files NEVER open by default, regardless of findings (REQ-3).
 * Currently just `boilerplate`; kept as a list (not a boolean) so the rule
 * reads as data, not a special case buried in `classify.ts`.
 */
export const ALWAYS_COLLAPSED_ROLES: readonly SmartDiffRole[] = ['boilerplate'];
