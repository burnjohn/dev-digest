import type { ConventionCategory, ProbeStrategy } from '@devdigest/shared';

/**
 * L02 — conventions extractor tuning. Every number here is a cost or a trust
 * knob; they are collected in one file so a scan's shape is readable without
 * chasing the service.
 */

/**
 * The categories extraction runs one focused pass per. One shared file-selection
 * call plus N narrow calls is what stops a single generic pass from collapsing
 * onto two or three topics — the failure mode of "find the conventions in this
 * repo" asked once.
 *
 * `testing` is deliberately absent: `getConventionSamples` routes through
 * repo-intel's `isJunkPath`, which drops `.test.` / `.spec.` / `__tests__/`, so a
 * testing rule would have no sampled file to cite evidence from.
 */
export const CONVENTION_CATEGORIES = [
  'naming',
  'structure',
  'error_handling',
  'async',
  'imports',
  'typing',
] as const satisfies readonly ConventionCategory[];

/**
 * Which corpus each category's conformance is counted over. The SERVER decides
 * this, never the model: a rule's category already determines what a "site" is,
 * and letting the model pick the engine would let it pick the denominator too.
 * A probe whose declared target disagrees with its category is rejected.
 *
 *  - `symbols` — every indexed declaration in the repo (name regex over a scope).
 *    The only strategy that can measure a naming rule at all.
 *  - `paths`   — every ranked file path (path regex over an `applies_to` scope).
 *  - `text`    — source text of the widened read corpus.
 */
export const COUNTING_STRATEGY: Record<ConventionCategory, ProbeStrategy> = {
  naming: 'symbols',
  structure: 'paths',
  typing: 'text',
  imports: 'text',
  async: 'text',
  error_handling: 'text',
};

/** Top-ranked files offered to the file-selection call. */
export const SAMPLE_FILES = 40;

/** Hard cap on files the model may pick to read in full. */
export const MAX_SELECTED_FILES = 14;

/**
 * Files read to count how widely a rule is actually followed (step F). Costs
 * `git.readFile` calls only — no tokens — so it can be far wider than the set the
 * model reads.
 */
export const SUPPORT_SCAN_FILES = 200;

/**
 * Per-file prompt budget. A long file is truncated, never skipped.
 *
 * Lowered alongside the `MAX_SELECTED_FILES` raise: 14 × 6k is ~1.3× today's
 * 8 × 8k in tokens for ~1.75× the file diversity, and a *convention* pass is
 * looking for a pattern repeated across files, not depth within one.
 */
export const MAX_FILE_CHARS = 6_000;

/** Indexed declarations pulled for the `symbols` strategy's denominator. */
export const SYMBOL_CORPUS_LIMIT = 20_000;

/** Ranked paths pulled for the `paths` strategy's denominator. */
export const PATH_CORPUS_LIMIT = 1_000;

/**
 * How far from the model's claimed line the snippet may actually be found and
 * still be believed. Wider than any realistic off-by-N, narrow enough that a
 * snippet matching somewhere else entirely in the file is treated as a
 * hallucinated citation and dropped.
 */
export const EVIDENCE_LINE_WINDOW = 40;

/**
 * Extra lines the grounding window may grow by beyond the snippet's own line
 * count, absorbing blank lines and reflow between the quote and the file.
 */
export const EVIDENCE_SPAN_SLACK = 3;

/**
 * The support gate is NOT a number here. A rule survives iff some file OTHER than
 * the one it was quoted from follows it — see `hasIndependentSupport`. Expressed
 * as a predicate rather than a threshold because "2 files" was only ever a proxy
 * for "something corroborates this", and the threshold reading is what produced
 * the old demote-don't-drop behaviour.
 *
 * The former `LOW_SUPPORT_PENALTY` and `MODEL_CONFIDENCE_WEIGHT` are gone with it:
 * the saturating support term below already collapses at low counts, so the
 * multiplicative penalty was charging a rule twice for the same fact.
 */

/**
 * Support at or above this many sites counts as fully corroborated. Per strategy,
 * because the unit differs: 8 files is broad, 8 declarations is not.
 */
export const SUPPORT_SATURATION: Record<ProbeStrategy, number> = {
  text: 8,
  symbols: 20,
  paths: 12,
};

/** Distinct directories at or above which a rule counts as repo-wide, not local. */
export const SPREAD_SATURATION_DIRS = 4;

/**
 * Confidence signal weights. An UNAVAILABLE signal is removed from both numerator
 * and denominator — never substituted with 0 (which would punish a rule for our
 * inability to check it) nor with 0.5 (which would invent evidence).
 */
export const W_CONFORMANCE = 0.4;
export const W_SUPPORT = 0.3;
export const W_SPREAD = 0.15;
export const W_MODEL = 0.15;

/**
 * Config declaration is an ADDITIVE boost, not a weighted signal: most real
 * conventions are unlinted, so the absence of a lint rule is not evidence against
 * one and must never drag the mean down.
 */
export const CONFIG_DECLARED_BOOST = 0.1;

/**
 * Ceiling for a rule whose denominator could not be measured. Without a violation
 * count there is no evidence of how often the rule is BROKEN, so the score must
 * not read as near-certainty however broad the support looks.
 */
export const INCOMPLETE_SIGNAL_CAP = 0.85;

// ---------------------------------------------------------- pattern safety
/**
 * The envelope every model-authored pattern must fit inside. Node has no regex
 * timeout, so safety comes from restricting the accepted DIALECT until
 * catastrophic backtracking is not constructible, rather than from a clock —
 * a wall-clock cutoff would make the same input score differently on a loaded
 * machine, and determinism is the whole point of `helpers.ts`.
 *
 * The accepted dialect is deliberately a subset of both JS `RegExp` and Rust's
 * `regex` crate (no lookaround, no backreferences), so a future ripgrep-backed
 * counting path would be a drop-in rather than a second escaping problem.
 */
export const MAX_PROBE_CHARS = 200;

/**
 * Metachar-stripped length a pattern must reach. This is a CORRECTNESS guard as
 * much as a safety one: `.*` is cheap to run and would report that 100% of the
 * repo conforms to whatever rule it was attached to.
 */
export const MIN_PROBE_LITERAL_CHARS = 3;

// Quantifier count, group depth and `{n,m}` bounds are NOT knobs here — they are
// part of the shared safety dialect in `platform/pattern-safety.ts`, which the
// `CodeIndex` adapter uses too. Two copies of a security validator drift.

/** Sites examined before counting stops and reports itself as partial. */
export const MAX_PROBE_SITES = 5_000;

/** Longest single string a probe is evaluated against, bounding one match call. */
export const MAX_PROBE_LINE_CHARS = 400;

/** Total config text fed to each extraction call. */
export const MAX_CONFIG_BLOCK_CHARS = 6_000;

/**
 * Token-set containment at or above this counts as "the same rule".
 *
 * Do not lower it to catch paraphrases — that is what the step-H2 semantic pass is
 * for. At 0.6 this gate starts merging genuinely different rules: two unrelated
 * three-token naming rules sharing two tokens score 0.67.
 */
export const DEDUP_SIMILARITY = 0.8;

/** Decided rules shown to the step-H2 dedup call, newest scan's survivors aside. */
export const MAX_DEDUP_RULES = 100;

/** Per-rule truncation in the dedup prompt. A rule is one sentence by contract. */
export const MAX_DEDUP_RULE_CHARS = 300;

/** Category extraction calls in flight at once. */
export const EXTRACTION_CONCURRENCY = 3;

/**
 * Project-configuration files fed to the selection call as context — they state
 * intent (strictness, lint rules, contributor docs) that the sampled source can
 * only imply.
 *
 * A LITERAL allowlist, not globs: each name is joined to the clone path, so an
 * exhaustive list is also the path-traversal guard. Missing files are simply
 * absent (`readFile` throws ENOENT on a real clone — the service catches it).
 */
export const CONFIG_FILES = [
  'tsconfig.json',
  'package.json',
  '.editorconfig',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yml',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  'CONTRIBUTING.md',
  'AGENTS.md',
] as const;

/** Per-config-file prompt budget — a digest, not the whole lockfile-sized truth. */
export const MAX_CONFIG_CHARS = 1_500;

/** Exported symbols listed per candidate path in the selection prompt. */
export const MAX_SYMBOLS_PER_FILE = 8;

/** Slug words per `## heading` in the merged skill body. */
export const SLUG_MAX_WORDS = 4;

/** The merged skill's name suffix: `<repo>-conventions`. */
export const SKILL_NAME_SUFFIX = '-conventions';
