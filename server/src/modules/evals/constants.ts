import type { FindingKind, Provider } from '@devdigest/shared';

/**
 * Eval scoring constants (SPEC-03 §"Scoring"). Module-private by definition —
 * nothing outside `modules/evals/` may import this file (onion-architecture §4).
 */

/**
 * Finding kinds that ground on file presence alone, never a diff-line
 * intersection — mirrors `FULL_FILE_KINDS` in `reviewer-core/src/grounding.ts`
 * (that file does not export its set, so this is a literal copy, not an
 * import). AC-24 reuses `groundFindings`' own rule for expectation matching;
 * it is not a new rule, so keep the two sets in sync if `FindingKind` changes.
 */
export const FULL_FILE_KINDS: ReadonlySet<FindingKind> = new Set<FindingKind>([
  'secret_leak',
  'lethal_trifecta',
  'phantom',
  'hook',
]);

/**
 * AC-72 — the neutral baseline reviewer prompt every skill-owned eval case's
 * `with` and `without` arm shares, byte-identical to SPEC-03's fenced block.
 * Every clause is load-bearing (see the spec's own note under AC-72) — do
 * not paraphrase, reflow, or "tighten" it: it is the measurement's zero
 * point, and editing it invalidates comparability across every batch that
 * straddles the change.
 */
export const EVAL_BASELINE_SYSTEM_PROMPT =
  'You are reviewing a unified diff from a pull request as an experienced software engineer.\n' +
  '\n' +
  'Report only defects this diff introduces or makes worse. Pre-existing problems, and code the diff does not touch, are out of scope.\n' +
  '\n' +
  'Report a finding only when you can name the concrete mechanism by which it fails — the input, state, or sequence that produces the wrong result. Do not report style, naming, formatting, or speculative concerns.\n' +
  '\n' +
  'An empty findings list is a valid and correct answer for a diff that contains no defect. Do not add findings to fill the response.';

/**
 * AC-72/AC-73 — the ONE baseline config a skill-owned case's `with` and
 * `without` arm both share: the fixed prompt above, plus whatever provider
 * and model the caller already resolved. Deliberately pure — resolving
 * `featureModel` itself is `resolveFeatureModel`'s job
 * (`modules/_shared/feature-models.ts`), a `Container`-shaped resolver only
 * R5/R6 may construct (onion-architecture §2) — so this function needs no
 * database and is hermetically testable (`test/evals-baseline.test.ts`).
 * `service.ts` builds a case's `SkillRunConfig` through this ONE function for
 * both `runCase` and `startBatch`'s skill branches, so "identical on both
 * arms" (AC-72) and "same provider/model on both arms" (AC-73) are enforced
 * by construction — `pipeline/case-runner.ts` already builds `baseInput`
 * once and spreads it into both arms (AC-61), so a single consistent config
 * here is what makes that guarantee hold end to end.
 */
export function evalBaselineConfig(featureModel: {
  provider: Provider;
  model: string;
}): { systemPrompt: string; provider: Provider; model: string } {
  return {
    systemPrompt: EVAL_BASELINE_SYSTEM_PROMPT,
    provider: featureModel.provider,
    model: featureModel.model,
  };
}

/**
 * How many batches per owner `GET /evals/dashboard` ships as `recent_batches`.
 *
 * The endpoint returns this list for EVERY enabled agent in one response, and
 * since a single-case run persists its own batch of 1 (owner decision,
 * 2026-08-29) the history grows by a row per click rather than per set run —
 * unbounded, that payload only ever gets bigger. The studio's own feed slices
 * to `RECENT_RUNS_LIMIT` (10) anyway, and the trend series is windowed
 * separately by `getTrendBatches`, so this cap costs the UI nothing.
 */
export const DASHBOARD_BATCH_HISTORY_LIMIT = 30;
