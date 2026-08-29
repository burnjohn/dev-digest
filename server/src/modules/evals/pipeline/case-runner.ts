import { z } from 'zod';
import type {
  EvalExpectedFinding,
  EvalForbiddenRegion,
  Finding,
  LLMProvider,
  Provider,
  UnifiedDiff,
} from '@devdigest/shared';
import { Finding as FindingContract, EvalAblationOutput } from '@devdigest/shared';
import type { EvalAblationWithArm, EvalAblationWithoutArm } from '@devdigest/shared';
import { reviewPullRequest, type ReviewStrategy } from '@devdigest/reviewer-core';
import { groundingCountsFromOutcome, scoreWithArm, scoreWithoutArm } from '../scoring.js';
import type { CaseTally, GroundingCounts } from '../types.js';
import type { EvalCaseRow } from '../repository.js';

/**
 * T9 — executes ONE agent-owned eval case (SPEC-03; REQ-13's execution half,
 * REQ-16, REQ-19, REQ-20, REQ-28, REQ-66-agent-side). Pure orchestration: no
 * `db/schema`, no `drizzle-orm`, no `fastify`, no `platform/container` — the
 * lazy `llm` resolver in `CaseRunnerDeps` is the ONLY seam to the outside
 * world (onion-architecture §3, "Lazy resolvers stay lazy"). REQ-20's "no git
 * clone, no GitHub client, no PR read" holds structurally: the only input
 * this file reads off `EvalCaseRow` is `inputDiff`/`expectedOutput`/
 * `forbiddenRegions`, and the only outbound call is `reviewPullRequest`
 * (`reviewer-core`, consumed as TypeScript source per its own
 * `2026-08-09` insight — never a compiled artefact).
 *
 * T18 — adds the skill-owned two-arm ablation (REQ-61 through REQ-67):
 * `runSkillCase` shares the same zero/multi-file diff guard and the same
 * missing-provider-key guard (`prepareCase`, below) with `runAgentCase`, and
 * scores the WITH arm through the same `scoreWithArm` T4 gives the agent
 * path. Only the with/without ablation logic itself is new.
 *
 * FIX-1 — `parseUnifiedDiff` (`adapters/git/diff-parser.ts`, ring R4) is
 * injected via `CaseRunnerDeps.parseUnifiedDiff` rather than imported here:
 * this file is R2 (`modules/<m>/pipeline/**`), and onion-architecture §2's R2
 * MAY-import list does not include `adapters/**`. The one construction site
 * for the real function is `routes.ts` (R5) — see its own doc comment.
 */

const FindingArray = z.array(FindingContract);

/** The agent config the caller (T13/T22, or a test) resolves once per batch —
 * from `agents` plus `EvalsRepository.getAgentSummary`. `provider` travels
 * alongside the lazy `llm` resolver purely so an errored case can NAME which
 * provider's key was missing; it plays no role in resolving the client. */
export interface AgentRunConfig {
  systemPrompt: string;
  model: string;
  provider: Provider;
  strategy?: ReviewStrategy;
}

/**
 * T18 — the runner-agent's config PLUS the one field that turns a single-arm
 * run into a two-arm ablation: the skill's own body. `skillBody` is the ONLY
 * field that may differ between the with and without `ReviewInput`s
 * (REQ-61) — everything else in `AgentRunConfig` is shared by both arms.
 */
export interface SkillRunConfig extends AgentRunConfig {
  /** The skill's current `body` (`EvalsRepository.getSkillSummary`/`getSkillVersionBody`). */
  skillBody: string;
}

export interface CaseRunnerDeps {
  /**
   * Lazy resolver — NEVER a resolved `LLMProvider` (onion-architecture §3):
   * booting with no keys configured is a product requirement, so resolution
   * (and its possible `ConfigError`) happens only when a case actually runs.
   */
  llm: () => Promise<LLMProvider>;
  /**
   * FIX-1: the ONE seam through which this R2 pipeline reaches R4's
   * `parseUnifiedDiff` (`adapters/git/diff-parser.ts`) — never a direct
   * import. The composition root (`routes.ts`) constructs the real function;
   * a hermetic test passes it directly (it is pure) or a fake.
   */
  parseUnifiedDiff: (raw: string) => UnifiedDiff;
}

/** The exact eight values (plus `batch_id`, added by the caller) REQ-28 persists per run row. */
export interface EvalRunValues {
  actualOutput: unknown;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  costUsd: number | null;
}

export interface CaseRunResult {
  caseId: string;
  /** REQ-19: true iff the case never produced a scored result. */
  errored: boolean;
  errorReason: string | null;
  values: EvalRunValues;
  /**
   * FIX-1 — the WITH arm's raw TP/FN/FP tally (agent case, or skill case's
   * with arm), `null` on an errored case. `batch-runner.ts` sums these across
   * a batch's cases and feeds the sums back through `computeRecall`/
   * `computePrecision` (T4, `scoring.ts`) to get one aggregate figure per
   * batch — never an average of already-computed per-case ratios, and never
   * a value contributed by a without arm (REQ-62).
   */
  tally: CaseTally | null;
  /** FIX-1 — the WITH arm's grounding kept/dropped counts, `null` on an
   * errored case. Folded the same way as `tally`, into `computeCitationAccuracy`. */
  grounding: GroundingCounts | null;
}

/** Builds an `errored` result — REQ-19's shape, timed from `start` on the wall clock. */
function erroredResult(caseId: string, start: number, reason: string): CaseRunResult {
  return {
    caseId,
    errored: true,
    errorReason: reason,
    values: {
      actualOutput: null,
      pass: null,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: Date.now() - start,
      costUsd: null,
    },
    tally: null,
    grounding: null,
  };
}

type PrepareCaseResult =
  | { ok: true; diff: UnifiedDiff; llm: LLMProvider }
  | { ok: false; result: CaseRunResult };

/**
 * REQ-19/REQ-66's zero/multi-file diff guard and REQ-19's missing-key guard —
 * ONE rule shared by the agent (with-arm-only) and skill (two-arm) paths, not
 * two copies that could drift. `provider` is only used to NAME the missing
 * key in the error reason; it plays no role in resolving the client.
 */
async function prepareCase(
  deps: CaseRunnerDeps,
  evalCase: EvalCaseRow,
  provider: Provider,
  start: number,
): Promise<PrepareCaseResult> {
  // REQ-20: the ONLY input is the case's own stored `input_diff` — no git
  // clone, no GitHub client, no PR read anywhere on this path. FIX-1: the
  // parser itself arrives through `deps.parseUnifiedDiff`, never a direct
  // adapter import (see this file's own doc comment).
  const diff = deps.parseUnifiedDiff(evalCase.inputDiff ?? '');

  // REQ-19: zero parsed files is an ERRORED case with a stated reason, never
  // an empty-but-valid diff silently scored against zero findings.
  if (diff.files.length === 0) {
    return { ok: false, result: erroredResult(evalCase.id, start, 'input_diff parsed to zero files') };
  }
  // REQ-66: an eval diff is always exactly one file. `selectMode`
  // (reviewer-core/src/review/run.ts:122-127) switches to map-reduce — one
  // model call PER FILE — as soon as `diff.files.length > 1`, under every
  // strategy; a multi-file case would silently break the batch's call count.
  // Rejected at the SAME place the zero-file case above is rejected.
  if (diff.files.length > 1) {
    return {
      ok: false,
      result: erroredResult(
        evalCase.id,
        start,
        `input_diff parsed to ${diff.files.length} files — an eval case must be exactly one file`,
      ),
    };
  }

  try {
    const llm = await deps.llm();
    return { ok: true, diff, llm };
  } catch (err) {
    // "a missing provider key surfaces as an errored case naming the
    // provider, not a thrown batch" — named explicitly here, since the
    // resolver's own `ConfigError` message only names the secret KEY.
    return {
      ok: false,
      result: erroredResult(
        evalCase.id,
        start,
        `Missing provider key for "${provider}": ${(err as Error).message}`,
      ),
    };
  }
}

/**
 * The case's own `forbidden_regions`, rendered as the do-not-report list
 * `reviewer-core` renders in the trusted half of the prompt.
 *
 * This is what makes a NEGATIVE (`must_not_flag`) case reachable at all. Such a
 * case is seeded from a finding the owner DISMISSED as a false positive
 * (`reviews/eval-draft.ts`), and until this existed the run had no way to know
 * that: the model saw the same frozen diff, re-reported the same defect, and
 * `scoring.ts` counted it as a false positive - so the case was red on every
 * run, for every agent, forever. Now the model is told, and the case measures
 * whether it OBEYS. It can still fail, which is the point: filtering the finding
 * out after the fact would have made the case unfailable and therefore worthless.
 *
 * Sourced from the case row alone - no DB read, no PR read, no GitHub client -
 * so REQ-20 still holds structurally. The line range is the same padded window
 * `scoring.ts` scores against, so the model is told exactly what the scorer
 * checks. Deliberately location-only: a finding `title` is model-generated text
 * derived from an untrusted diff and must not be promoted into a trusted prompt
 * section.
 */
function buildSuppressions(forbiddenRegions: EvalForbiddenRegion[] | null): string[] {
  if (!forbiddenRegions) return [];
  return forbiddenRegions.map(
    (region) => `${region.file}:${region.start_line}-${region.end_line}`,
  );
}

/**
 * Executes one eval case end to end: parse `input_diff`, run the with arm
 * through the review engine once, score it (T4's `scoreWithArm`), and return
 * the row values REQ-28 persists. `ReviewOutcome` carries `costUsd` but no
 * `durationMs` — this function owns the wall clock.
 */
export async function runAgentCase(
  deps: CaseRunnerDeps,
  agent: AgentRunConfig,
  evalCase: EvalCaseRow,
): Promise<CaseRunResult> {
  const start = Date.now();

  const prepared = await prepareCase(deps, evalCase, agent.provider, start);
  if (!prepared.ok) return prepared.result;
  const { diff, llm } = prepared;

  // Eval path assembles NO prompt of its own — this goes through
  // `reviewPullRequest` exactly like `run-executor.ts`'s agent path
  // (~line 341-377), so the frozen hostile diff inherits the same
  // untrusted-content framing and injection guard.
  const expectedOutput = (evalCase.expectedOutput ?? []) as EvalExpectedFinding[];
  const forbiddenRegions = (evalCase.forbiddenRegions ?? null) as EvalForbiddenRegion[] | null;
  const suppressions = buildSuppressions(forbiddenRegions);

  const outcome = await reviewPullRequest({
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    diff,
    llm,
    strategy: agent.strategy,
    // Omit-when-empty, the same spread convention `run-executor.ts` uses for
    // `skills`/`callers`/`repoMap`: a case with no forbidden regions (every
    // `must_find` case, and any hand-authored negative one) assembles exactly
    // the prompt it did before suppressions existed.
    ...(suppressions.length > 0 ? { suppressions } : {}),
    task: `Run eval case "${evalCase.name}"`,
    sessionId: `eval-case:${evalCase.id}`,
  });
  const score = scoreWithArm(
    { expectedOutput, forbiddenRegions, findings: outcome.review.findings },
    outcome,
  );

  // Validate-before-persist at the WRITE chokepoint (server/INSIGHTS.md,
  // 2026-08-25): `eval_runs.actual_output` is opaque jsonb that only fails on
  // read, so a malformed findings array is caught HERE — the one and only
  // producer of this value — rather than parked in a helper a caller could
  // skip.
  const actualOutput: Finding[] = FindingArray.parse(outcome.review.findings);

  return {
    caseId: evalCase.id,
    errored: false,
    errorReason: null,
    values: {
      actualOutput,
      pass: score.pass,
      recall: score.recall,
      precision: score.precision,
      citationAccuracy: score.citationAccuracy,
      durationMs: Date.now() - start,
      costUsd: outcome.costUsd,
    },
    tally: score.tally,
    grounding: groundingCountsFromOutcome(outcome),
  };
}

/** `null` iff BOTH are `null`; otherwise the sum of whichever are non-null
 * (AC-27: "a skill-owned case's per-case `cost_usd` is itself the sum of its
 * two arms' non-null `costUsd` values"). */
function sumArmCosts(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * T18 — executes ONE skill-owned eval case's with/without ablation (REQ-61
 * through REQ-67). Shares `prepareCase`'s diff/llm guard with `runAgentCase`
 * so REQ-19/REQ-66 are ONE rule, not two.
 *
 * `options.runWithoutArm` distinguishes AC-50's "a single-case run executes
 * the with arm only" (the caller passes `false`) from a full batch (the
 * batch runner always passes `true`) — the SAME function serves both, so the
 * with-arm execution, scoring and persistence shape can never drift between
 * the two callers.
 */
export async function runSkillCase(
  deps: CaseRunnerDeps,
  config: SkillRunConfig,
  evalCase: EvalCaseRow,
  options: { runWithoutArm: boolean } = { runWithoutArm: true },
): Promise<CaseRunResult> {
  const start = Date.now();

  const prepared = await prepareCase(deps, evalCase, config.provider, start);
  if (!prepared.ok) return prepared.result;
  const { diff, llm } = prepared;

  const expectedOutput = (evalCase.expectedOutput ?? []) as EvalExpectedFinding[];
  const forbiddenRegions = (evalCase.forbiddenRegions ?? null) as EvalForbiddenRegion[] | null;
  const suppressions = buildSuppressions(forbiddenRegions);

  // The ONE `ReviewInput` shape shared by both arms — REQ-61's "otherwise
  // identical `ReviewInput`" and "vary no other field" are enforced
  // structurally by building this ONCE and spreading it, rather than by two
  // independently-typed call sites that could silently diverge.
  const baseInput = {
    systemPrompt: config.systemPrompt,
    model: config.model,
    diff,
    llm,
    strategy: config.strategy,
    // In `baseInput`, so BOTH arms carry the identical suppression list -
    // REQ-61's "vary no other field" (and server/INSIGHTS.md 2026-08-29: a
    // constant shared by both arms cancels in the lift, which is correct here;
    // a list only one arm saw would not).
    ...(suppressions.length > 0 ? { suppressions } : {}),
    task: `Run eval case "${evalCase.name}"`,
    sessionId: `eval-case:${evalCase.id}`,
  };

  // ---- WITH arm (REQ-61/REQ-62) --------------------------------------------
  // A failure here errors the WHOLE case — the same convention as the
  // agent-owned path (REQ-19's "the with arm errors" row) — so it is
  // deliberately NOT try/caught here; the batch runner's per-case catch (or
  // the single-case caller) is the one boundary that turns it into an
  // errored result.
  const withOutcome = await reviewPullRequest({ ...baseInput, skills: [config.skillBody] });
  const withScore = scoreWithArm(
    { expectedOutput, forbiddenRegions, findings: withOutcome.review.findings },
    withOutcome,
  );
  const withArm: EvalAblationWithArm = {
    recall: withScore.recall,
    precision: withScore.precision,
    citation_accuracy: withScore.citationAccuracy,
    findings: withOutcome.review.findings,
  };

  // ---- WITHOUT arm (REQ-63/REQ-65) -----------------------------------------
  // Omits `skills` entirely — the SAME omit-when-empty spread
  // `run-executor.ts:357` uses, never `skills: []` (an empty array is not
  // the absence `assemblePrompt` checks for).
  let withoutArm: EvalAblationWithoutArm;
  let withoutCostUsd: number | null = null;
  if (!options.runWithoutArm) {
    // AC-50/AC-65: a single-case run never attempts the without arm at all —
    // distinguishable in storage from an attempted-and-failed one.
    withoutArm = { unavailable: 'not_run' };
  } else {
    try {
      const withoutOutcome = await reviewPullRequest({ ...baseInput });
      withoutCostUsd = withoutOutcome.costUsd;
      const withoutScore = scoreWithoutArm({
        expectedOutput,
        forbiddenRegions,
        findings: withoutOutcome.review.findings,
      });
      withoutArm = { recall: withoutScore.recall, findings: withoutOutcome.review.findings };
    } catch (err) {
      // REQ-65/REQ-19: an errored without arm keeps the WITH arm's `pass`
      // and metrics and does NOT count the case as errored — only the
      // stored `without` value records the failure.
      withoutArm = { unavailable: 'errored', reason: (err as Error).message };
    }
  }

  // Validate-before-persist at the WRITE chokepoint (server/INSIGHTS.md,
  // 2026-08-25): ONE parse of the whole `{with, without}` object, right
  // before it becomes the row's `actual_output` — never two separate parses
  // a future edit could get out of sync.
  const actualOutput = EvalAblationOutput.parse({ with: withArm, without: withoutArm });

  return {
    caseId: evalCase.id,
    errored: false,
    errorReason: null,
    values: {
      actualOutput,
      // REQ-62: the case's pass/metrics come from the WITH arm alone.
      pass: withScore.pass,
      recall: withScore.recall,
      precision: withScore.precision,
      citationAccuracy: withScore.citationAccuracy,
      durationMs: Date.now() - start,
      costUsd: sumArmCosts(withOutcome.costUsd, withoutCostUsd),
    },
    // FIX-1/REQ-62: WITH arm only, never the without arm — the same rule as
    // `values.pass` above.
    tally: withScore.tally,
    grounding: groundingCountsFromOutcome(withOutcome),
  };
}
