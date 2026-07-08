// patternMatch() here is UNRELATED to reviewer-core's groundFindings() citation gate — see
// docs/plans/2026-07-06-skill-eval-pipeline.md §4 Constraints for the naming-collision note.
// groundFindings() runs inside reviewPullRequest() itself and is never touched or bypassed by
// this file.
/**
 * skills/eval-scoring.ts — deterministic pattern-match gate + LLM practices judge for the
 * skill-eval pipeline (sibling to, and independent of, `eval/scoring.ts`'s agent-eval
 * recall/precision/citation methodology).
 *
 * `patternMatch()` is a pure function: zero I/O, zero LLM calls (AC-27). `judgePractices()` is
 * the ONE real LLM call per judged case — it goes through `container.llm(provider)` exactly as
 * every other structured-output call site in this codebase does (see `onboarding/service.ts`,
 * `reviews/brief-generator.ts`, `conventions/extractor.ts`): pass a Zod schema straight to
 * `LLMProvider.completeStructured()`, which internally handles JSON-schema conversion and
 * repair-on-malformed-output. No direct `toJsonSchema`/`parseWithRepair` call is needed here —
 * those live inside `reviewer-core`'s own adapters (`openrouter.ts`) and inside this codebase's
 * `openai.ts`/`anthropic.ts` adapters, never at the call site.
 */
import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import type { JudgeVerdict, Provider } from '@devdigest/shared';

/**
 * Case-insensitive all-substrings-present check, ported from
 * `evals/src/scoring/pattern-match.ts`'s algorithm (`output.toLowerCase().includes(e.toLowerCase())`
 * per substring). Unlike the harness's own `patternMatch` (which returns a 0..1 fraction), this
 * returns pass/fail PLUS the list of missing substrings — needed for
 * `SkillEvalBatchCaseOutcome.grounding_missing` (AC-20/AC-21).
 *
 * An empty `expected` array returns `{ passed: true, missing: [] }` (AC-20 — no grounding
 * requirement = vacuously satisfied).
 */
export function patternMatch(
  output: string,
  expected: string[],
): { passed: boolean; missing: string[] } {
  if (expected.length === 0) return { passed: true, missing: [] };
  const low = output.toLowerCase();
  const missing = expected.filter((e) => !low.includes(e.toLowerCase()));
  return { passed: missing.length === 0, missing };
}

/** Structured-output schema for the practices judge — matches `JudgeVerdict`'s shape. */
const JudgeVerdictSchema = z.object({
  results: z.array(
    z.object({
      practice: z.string(),
      passed: z.boolean(),
      evidence: z.string(),
    }),
  ),
});

/**
 * Rubric prompt mirroring `evals/src/scoring/llm-judge.ts`'s `JUDGE_RUBRIC` in spirit: a strict
 * blind evaluator, binary PASS/FAIL per practice, PASS only with a verbatim quote as evidence.
 * Adapted here to request STRUCTURED JSON output via `completeStructured` rather than free-text
 * JSON-in-a-string (the CLI harness's own approach) — the server already has a first-class
 * structured-output path via `LLMProvider.completeStructured`.
 */
const JUDGE_SYSTEM_PROMPT =
  'You are a strict, blind evaluator. Given an OUTPUT and a list of PRACTICES, judge each ' +
  'practice independently.\n' +
  'Rules: (1) exactly PASS or FAIL per practice, no scales. (2) PASS only when a direct ' +
  'verbatim quote from the OUTPUT is evidence the practice was met — a keyword alone is not ' +
  'evidence. (3) Judge only what is written in OUTPUT; never reward practices the OUTPUT does ' +
  'not itself demonstrate.';

function buildJudgeUserMessage(output: string, practices: string[]): string {
  const listed = practices.map((p, i) => `${i + 1}. ${p}`).join('\n');
  return `## PRACTICES\n${listed}\n\n## OUTPUT\n${output}`;
}

/**
 * `judgePractices` returns the `JudgeVerdict` wire shape PLUS the judge LLM call's own cost, so
 * the orchestrator can attribute it per-case/per-batch (AC-33). `costUsd` is an internal
 * orchestrator concern, NOT part of the `JudgeVerdict` wire contract — hence a superset type here
 * rather than a change to `contracts/skill-eval.ts`.
 */
export interface JudgePracticesResult extends JudgeVerdict {
  costUsd: number;
}

/**
 * The ONE real LLM call per judged case (AC-22, AC-27). Builds a rubric prompt, calls
 * `container.llm(provider).completeStructured()` with the `JudgeVerdictSchema`, and computes
 * `score = passed_count / total_count`.
 *
 * Caller only invokes this when `practices.length > 0`, so `total_count` (== `results.length`,
 * which mirrors `practices.length` since the judge returns one verdict per input practice) is
 * guaranteed non-zero — no division-by-zero guard needed here.
 */
export async function judgePractices(
  container: Container,
  provider: Provider,
  model: string,
  output: string,
  practices: string[],
): Promise<JudgePracticesResult> {
  const llm = await container.llm(provider);
  const result = await llm.completeStructured({
    model,
    schema: JudgeVerdictSchema,
    schemaName: 'JudgeVerdict',
    messages: [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT },
      { role: 'user', content: buildJudgeUserMessage(output, practices) },
    ],
  });

  const results = result.data.results;
  const total = results.length;
  const passedCount = results.filter((r) => r.passed).length;
  const score = total === 0 ? 0 : passedCount / total;

  // AC-33: surface the judge call's cost (null → 0) so the orchestrator can add it to the
  // case's total alongside the review call's cost.
  return { score, results, costUsd: result.costUsd ?? 0 };
}

/**
 * AC-24's exact pass rule: passed when (grounding passed OR no grounding requirement) AND
 * (no practices to judge OR judge score >= threshold).
 */
export function casePassed(
  groundingResult: { passed: boolean },
  hasGrounding: boolean,
  judgeResult: JudgeVerdict | null,
  hasPractices: boolean,
  threshold: number,
): boolean {
  const groundingOk = !hasGrounding || groundingResult.passed;
  const judgeOk = !hasPractices || (judgeResult !== null && judgeResult.score >= threshold);
  return groundingOk && judgeOk;
}
