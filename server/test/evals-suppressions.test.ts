/**
 * The trusted do-not-report channel that makes a NEGATIVE eval case reachable.
 *
 * A `must_not_flag` case is seeded from a finding the owner DISMISSED as a false
 * positive (`reviews/eval-draft.ts`). Before this existed the runner handed the
 * model the same frozen diff with no hint that the finding had been rejected, the
 * model re-reported it, and `scoring.ts` counted it as a false positive — so the
 * case was red on every run, for every agent, permanently. `case-runner.ts` now
 * turns the case's own `forbidden_regions` into the suppression list.
 *
 * Hermetic: a fake `LLMProvider` only, no DB and no real model call. Every claim
 * is provable from the recorded `req.messages` plus the returned score.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ChatMessage, LLMProvider, Review, StructuredRequest } from '@devdigest/shared';
import { buildAgentCaseDiff } from '../src/modules/_shared/diff-synth.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import {
  runAgentCase,
  runSkillCase,
  type AgentRunConfig,
  type CaseRunnerDeps,
  type SkillRunConfig,
} from '../src/modules/evals/pipeline/case-runner.js';
import type { EvalCaseRow } from '../src/modules/evals/repository.js';

const FILE = 'server/src/contracts/skills-api.ts';
const REGION = { file: FILE, start_line: 16, end_line: 22 };

const AGENT: AgentRunConfig = {
  systemPrompt: 'Review carefully.',
  model: 'gpt-4.1',
  provider: 'openai',
};
const SKILL: SkillRunConfig = { ...AGENT, skillBody: 'Flag every TODO left in the diff.' };

const EMPTY_REVIEW: Review = {
  verdict: 'comment',
  summary: 'nothing to report',
  score: 95,
  findings: [],
};

const FLAGGED_REVIEW: Review = {
  verdict: 'comment',
  summary: 'found one',
  score: 60,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'bug',
      // The exact drift that made the real case red: cited at 22, guarded 16-22.
      title: 'Breaking field rename',
      file: FILE,
      start_line: 22,
      end_line: 22,
      rationale: 'because',
      confidence: 0.9,
    },
  ],
};

let seq = 0;
function makeCase(overrides: Partial<EvalCaseRow> = {}): EvalCaseRow {
  seq += 1;
  return {
    id: `case-${seq}`,
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    name: `Case ${seq}`,
    // 24 added lines, so a finding cited at line 22 is inside the diff and
    // survives grounding rather than being dropped before it can be scored.
    inputDiff: buildAgentCaseDiff(
      FILE,
      `@@ -1,0 +1,24 @@\n${Array.from({ length: 24 }, (_, i) => `+line ${i + 1}`).join('\n')}`,
    ),
    inputFiles: null,
    inputMeta: null,
    expectedOutput: [],
    notes: null,
    expectationKind: 'must_not_flag',
    forbiddenRegions: [REGION],
    inputFilename: null,
    ...overrides,
  } as EvalCaseRow;
}

function makeLlm(fixtures: Review[]): { llm: LLMProvider; calls: { req: unknown }[] } {
  const calls: { req: unknown }[] = [];
  let index = 0;
  const llm: LLMProvider = {
    id: 'openai',
    async listModels() {
      return [];
    },
    async complete() {
      throw new Error('unexpected complete() call');
    },
    async embed(texts: string[]) {
      return texts.map(() => []);
    },
    async completeStructured<T>(req: StructuredRequest<T>) {
      calls.push({ req });
      const fixture = fixtures[index] ?? fixtures[fixtures.length - 1];
      index += 1;
      const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
      if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
      return {
        data: parsed.data,
        model: req.model,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.001,
        raw: '{}',
        attempts: 1,
      };
    },
  };
  return { llm, calls };
}

function messagesOf(call: { req: unknown }): { system: string; user: string } {
  const { messages } = call.req as { messages: ChatMessage[] };
  return { system: messages[0]!.content, user: messages[1]!.content };
}

describe('case-runner — dismissed-finding suppressions', () => {
  it("sends the case's forbidden region to the model as a trusted do-not-report entry", async () => {
    const { llm, calls } = makeLlm([EMPTY_REVIEW]);
    const deps: CaseRunnerDeps = { llm: async () => llm, parseUnifiedDiff };

    await runAgentCase(deps, AGENT, makeCase());

    const { system, user } = messagesOf(calls[0]!);
    expect(user).toContain('## Dismissed findings - do not report');
    // The location the SCORER checks, verbatim — the model is told exactly what
    // it will be graded on, padded window included.
    expect(user).toContain(`- ${FILE}:16-22`);
    expect(system).toMatch(/DISMISSED FINDINGS/);
    // No finding title reaches the prompt: it is model-generated text derived
    // from an untrusted diff and must not enter the trusted half.
    expect(user).not.toContain('Breaking field rename');
  });

  it('a must_find case sends no suppressions at all — the positive arm is unchanged', async () => {
    const { llm, calls } = makeLlm([EMPTY_REVIEW]);
    const deps: CaseRunnerDeps = { llm: async () => llm, parseUnifiedDiff };

    await runAgentCase(
      deps,
      AGENT,
      makeCase({
        expectationKind: 'must_find',
        expectedOutput: [
          {
            severity: 'CRITICAL',
            category: 'bug',
            title: 'x',
            file: FILE,
            start_line: 16,
            end_line: 22,
          },
        ],
        forbiddenRegions: [],
      }),
    );

    const { system, user } = messagesOf(calls[0]!);
    expect(user).not.toContain('## Dismissed findings');
    expect(system).not.toMatch(/DISMISSED FINDINGS/);
  });

  it('the negative case PASSES when the model obeys, and still FAILS when it does not', async () => {
    const deps = (llm: LLMProvider): CaseRunnerDeps => ({ llm: async () => llm, parseUnifiedDiff });

    const obeyed = makeLlm([EMPTY_REVIEW]);
    const passing = await runAgentCase(deps(obeyed.llm), AGENT, makeCase());
    expect(passing.values.pass).toBe(true);
    expect(passing.values.actualOutput).toEqual([]);

    // The guarantee that this stays a TEST: telling the model does not force the
    // outcome. A model that reports it anyway is still red — which is exactly
    // what filtering the finding out after the fact would have destroyed.
    const ignored = makeLlm([FLAGGED_REVIEW]);
    const failing = await runAgentCase(deps(ignored.llm), AGENT, makeCase());
    expect(failing.values.pass).toBe(false);
    expect(failing.tally).toEqual({ tp: 0, fn: 0, fp: 1 });
  });

  it('REQ-61: both ablation arms receive the IDENTICAL suppression list', async () => {
    const { llm, calls } = makeLlm([EMPTY_REVIEW, EMPTY_REVIEW]);
    const deps: CaseRunnerDeps = { llm: async () => llm, parseUnifiedDiff };

    await runSkillCase(deps, SKILL, makeCase({ ownerKind: 'skill', ownerId: 'skill-1' }));

    expect(calls).toHaveLength(2);
    const withArm = messagesOf(calls[0]!);
    const withoutArm = messagesOf(calls[1]!);

    expect(withArm.user).toContain(`- ${FILE}:16-22`);
    expect(withoutArm.user).toContain(`- ${FILE}:16-22`);
    // A suppression list only one arm saw would show up as a lift that is really
    // an artefact of the prompt — so the arms must be identical outside `skills`.
    expect(withArm.system).toBe(withoutArm.system);
  });
});
