import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import type { ChatMessage, LLMProvider, Review, StructuredRequest } from '@devdigest/shared';
import { assemblePrompt } from '@devdigest/reviewer-core';
import { buildSkillCaseDiff, buildAgentCaseDiff } from '../src/modules/_shared/diff-synth.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import {
  runSkillCase,
  type CaseRunnerDeps,
  type SkillRunConfig,
} from '../src/modules/evals/pipeline/case-runner.js';
import type { AgentRunConfig } from '../src/modules/evals/pipeline/case-runner.js';
import {
  startAgentBatch,
  startSkillBatch,
  type BatchRunnerDeps,
  type StartAgentBatchParams,
  type StartSkillBatchParams,
} from '../src/modules/evals/pipeline/batch-runner.js';
import type {
  CompleteEvalBatch,
  EvalBatchRow,
  EvalCaseRow,
  EvalRunRow,
  InsertEvalBatch,
  InsertEvalRun,
} from '../src/modules/evals/repository.js';

/**
 * T18 — the with/without ablation (SPEC-03; REQ-61 through REQ-67-the-data).
 * Hermetic: `MockLLMProvider`-shaped fakes only, no DB, no real model call —
 * REQ-61's byte-equality claim is provable from the recorded `req.messages`
 * alone (this task's `Do:`).
 */

let caseSeq = 0;
function makeSkillCase(overrides: Partial<EvalCaseRow> = {}): EvalCaseRow {
  caseSeq += 1;
  return {
    id: `skill-case-${caseSeq}`,
    workspaceId: 'ws-1',
    ownerKind: 'skill',
    ownerId: 'skill-1',
    name: `Skill case ${caseSeq}`,
    inputDiff: buildSkillCaseDiff({ after: 'line one\nline two', filename: 'src/x.ts' }),
    inputFiles: { kind: 'new_file', filename: 'src/x.ts', after: 'line one\nline two' },
    inputMeta: null,
    expectedOutput: [],
    notes: null,
    expectationKind: 'must_not_flag',
    forbiddenRegions: null,
    inputFilename: 'src/x.ts',
    ...overrides,
  } as EvalCaseRow;
}

const SKILL_BODY = 'Flag every TODO comment left in the diff.';

const CONFIG: SkillRunConfig = {
  systemPrompt: 'Review carefully.',
  model: 'gpt-4.1',
  provider: 'openai',
  skillBody: SKILL_BODY,
};

const EMPTY_REVIEW: Review = { verdict: 'comment', summary: 'looks fine', score: 90, findings: [] };

function findingAt(file: string, startLine: number, endLine: number): Review['findings'][number] {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Suspicious change',
    file,
    start_line: startLine,
    end_line: endLine,
    rationale: 'because',
    confidence: 0.9,
  };
}

/** A fake `LLMProvider` returning one fixture per call, in order (the last
 * fixture repeats past the end) — unlike `MockLLMProvider`, which returns
 * the SAME fixture for every call, this is what proves the with/without
 * arms were actually scored from DIFFERENT engine outputs (REQ-62/REQ-63),
 * not merely from two identical calls. Records every call like
 * `MockLLMProvider.calls` (REQ-61's own testing note) and can inject an
 * artificial delay to make an out-of-order (concurrent) call observable
 * (REQ-16), and can throw on a specific call index (REQ-65's errored
 * without arm). */
function makeSequencedLlm(
  fixtures: unknown[],
  options: { delayMs?: number; throwOnCallIndex?: number } = {},
): { llm: LLMProvider; calls: { method: string; req: unknown }[]; maxInFlight: () => number } {
  const calls: { method: string; req: unknown }[] = [];
  let inFlight = 0;
  let max = 0;
  let index = 0;
  const llm: LLMProvider = {
    id: 'openai',
    async listModels() {
      return [];
    },
    async complete() {
      throw new Error('unexpected complete() call in this test');
    },
    async embed(texts: string[]) {
      return texts.map(() => []);
    },
    async completeStructured<T>(req: StructuredRequest<T>) {
      calls.push({ method: 'completeStructured', req });
      const callIndex = index;
      index += 1;
      inFlight += 1;
      max = Math.max(max, inFlight);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      inFlight -= 1;
      if (options.throwOnCallIndex === callIndex) {
        throw new Error(`simulated engine failure on call ${callIndex}`);
      }
      const fixture = fixtures[callIndex] ?? fixtures[fixtures.length - 1];
      const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
      if (!parsed.success) throw new Error(`fixture failed schema: ${parsed.error.message}`);
      return {
        data: parsed.data,
        model: req.model,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.001,
        raw: JSON.stringify(fixture),
        attempts: 1,
      };
    },
  };
  return { llm, calls, maxInFlight: () => max };
}

describe('case-runner — runSkillCase (REQ-61, REQ-62, REQ-63, REQ-64, REQ-65)', () => {
  it('REQ-61: the with and without arms’ assembled prompts differ only by the skills section', async () => {
    const evalCase = makeSkillCase();
    const { llm, calls } = makeSequencedLlm([EMPTY_REVIEW, EMPTY_REVIEW]);
    const deps: CaseRunnerDeps = { llm: async () => llm, parseUnifiedDiff };

    await runSkillCase(deps, CONFIG, evalCase);

    expect(calls).toHaveLength(2);
    const withReq = calls[0]!.req as { messages: ChatMessage[] };
    const withoutReq = calls[1]!.req as { messages: ChatMessage[] };

    const raw = parseUnifiedDiff(evalCase.inputDiff ?? '').raw;
    const task = `Run eval case "${evalCase.name}"`;
    const expectedWith = assemblePrompt({
      system: CONFIG.systemPrompt,
      diff: raw,
      task,
      skills: [SKILL_BODY],
    });
    const expectedWithout = assemblePrompt({ system: CONFIG.systemPrompt, diff: raw, task });

    // Exact byte equality against independently-assembled prompts.
    expect(withReq.messages).toEqual(expectedWith.messages);
    expect(withoutReq.messages).toEqual(expectedWithout.messages);

    // The system message never varies with skills (only `intent` touches it).
    expect(withReq.messages[0]).toEqual(withoutReq.messages[0]);
    // The user message differs ONLY by the "## Skills / rules" section, not by
    // "the skills block is absent" alone — stripping it reproduces the
    // without arm's user message exactly.
    const skillsSection = `## Skills / rules\n${SKILL_BODY}\n\n`;
    const withUser = withReq.messages[1]!.content;
    const withoutUser = withoutReq.messages[1]!.content;
    expect(withUser).not.toBe(withoutUser);
    expect(withUser.replace(skillsSection, '')).toBe(withoutUser);
  });

  it('REQ-62/REQ-63: pass/recall/precision/citation come from the with arm alone; the without arm carries only recall+findings', async () => {
    const evalCase = makeSkillCase({
      expectedOutput: [
        {
          severity: 'WARNING',
          category: 'bug',
          title: 'Suspicious change',
          start_line: 1,
          end_line: 2,
          file: 'src/x.ts',
        },
      ],
      expectationKind: 'must_find',
    });
    // WITH arm finds the expectation (recall 1, precision 1); WITHOUT arm
    // finds nothing (recall 0) — deliberately DIFFERENT outcomes, so a test
    // that accidentally read the without arm's value would fail loudly.
    const withReview: Review = { ...EMPTY_REVIEW, findings: [findingAt('src/x.ts', 1, 2)] };
    const { llm, calls } = makeSequencedLlm([withReview, EMPTY_REVIEW]);
    const deps: CaseRunnerDeps = { llm: async () => llm, parseUnifiedDiff };

    const result = await runSkillCase(deps, CONFIG, evalCase);

    expect(calls).toHaveLength(2);
    expect(result.errored).toBe(false);
    expect(result.values.pass).toBe(true);
    expect(result.values.recall).toBe(1);
    expect(result.values.precision).toBe(1);

    const output = result.values.actualOutput as {
      with: { recall: number | null; precision: number | null; citation_accuracy: number | null };
      without: { recall?: number | null; precision?: number; citation_accuracy?: number };
    };
    expect(output.with.recall).toBe(1);
    expect(output.without.recall).toBe(0);
    // AC-63's asymmetry, checked structurally — not merely "falsy".
    expect('precision' in output.without).toBe(false);
    expect('citation_accuracy' in output.without).toBe(false);
  });

  it('REQ-65: a single-case run (runWithoutArm: false) stores {unavailable: "not_run"} and makes one call', async () => {
    const evalCase = makeSkillCase();
    const { llm, calls } = makeSequencedLlm([EMPTY_REVIEW]);
    const deps: CaseRunnerDeps = { llm: async () => llm, parseUnifiedDiff };

    const result = await runSkillCase(deps, CONFIG, evalCase, { runWithoutArm: false });

    expect(calls).toHaveLength(1);
    expect(result.errored).toBe(false);
    const output = result.values.actualOutput as { without: unknown };
    expect(output.without).toEqual({ unavailable: 'not_run' });
  });

  it('REQ-65/REQ-19: an errored without arm keeps the with arm’s pass and metrics, and the case is NOT errored', async () => {
    const evalCase = makeSkillCase({
      expectedOutput: [
        {
          severity: 'WARNING',
          category: 'bug',
          title: 'Suspicious change',
          start_line: 1,
          end_line: 2,
          file: 'src/x.ts',
        },
      ],
      expectationKind: 'must_find',
    });
    const withReview: Review = { ...EMPTY_REVIEW, findings: [findingAt('src/x.ts', 1, 2)] };
    const { llm, calls } = makeSequencedLlm([withReview, EMPTY_REVIEW], { throwOnCallIndex: 1 });
    const deps: CaseRunnerDeps = { llm: async () => llm, parseUnifiedDiff };

    const result = await runSkillCase(deps, CONFIG, evalCase);

    expect(calls).toHaveLength(2);
    expect(result.errored).toBe(false); // REQ-19: not counted as errored
    expect(result.values.pass).toBe(true); // the WITH arm's pass survives
    expect(result.values.recall).toBe(1);
    const output = result.values.actualOutput as { without: { unavailable?: string; reason?: string } };
    expect(output.without.unavailable).toBe('errored');
    expect(output.without.reason).toContain('simulated engine failure');
  });

  it('REQ-16: the with and without arms of one case never run concurrently', async () => {
    const evalCase = makeSkillCase();
    const { llm, maxInFlight } = makeSequencedLlm([EMPTY_REVIEW, EMPTY_REVIEW], { delayMs: 5 });
    const deps: CaseRunnerDeps = { llm: async () => llm, parseUnifiedDiff };

    await runSkillCase(deps, CONFIG, evalCase);

    expect(maxInFlight()).toBe(1);
  });

  it('REQ-19/REQ-66: the zero/multi-file diff guard runs before either arm, exactly as for an agent case', async () => {
    const evalCase = makeSkillCase({ inputDiff: '' });
    const { llm, calls } = makeSequencedLlm([EMPTY_REVIEW, EMPTY_REVIEW]);
    const deps: CaseRunnerDeps = { llm: async () => llm, parseUnifiedDiff };

    const result = await runSkillCase(deps, CONFIG, evalCase);

    expect(result.errored).toBe(true);
    expect(result.errorReason).toMatch(/zero files/);
    expect(calls).toHaveLength(0);
  });
});

// ===========================================================================
// batch-runner — startSkillBatch
// ===========================================================================

/** In-memory double for `Pick<EvalsRepository, 'insertBatch' | 'insertRun' | 'completeBatch'>` —
 * mirrors `test/evals-batch-runner.test.ts`'s own double. */
function makeRepoDouble() {
  const insertBatchCalls: InsertEvalBatch[] = [];
  const insertRunCalls: InsertEvalRun[] = [];
  const completeBatchCalls: { workspaceId: string; id: string; patch: CompleteEvalBatch }[] = [];
  let batchSeq = 0;
  let runSeq = 0;

  const repo: BatchRunnerDeps['repo'] = {
    async insertBatch(values) {
      insertBatchCalls.push(values);
      batchSeq += 1;
      return {
        id: `batch-${batchSeq}`,
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        ownerVersion: values.ownerVersion,
        runnerAgentId: values.runnerAgentId ?? null,
        runnerAgentVersion: values.runnerAgentVersion ?? null,
        startedAt: new Date(),
        finishedAt: null,
        status: 'running',
        recall: null,
        precision: null,
        citationAccuracy: null,
        casesPassed: null,
        casesTotal: null,
        costUsd: null,
      } as EvalBatchRow;
    },
    async insertRun(values) {
      insertRunCalls.push(values);
      runSeq += 1;
      return {
        id: `run-${runSeq}`,
        caseId: values.caseId,
        batchId: values.batchId ?? null,
        ranAt: new Date(),
        actualOutput: values.actualOutput ?? null,
        pass: values.pass ?? null,
        recall: values.recall ?? null,
        precision: values.precision ?? null,
        citationAccuracy: values.citationAccuracy ?? null,
        durationMs: values.durationMs ?? null,
        costUsd: values.costUsd ?? null,
      } as EvalRunRow;
    },
    async completeBatch(workspaceId, id, patch) {
      completeBatchCalls.push({ workspaceId, id, patch });
      return { id, status: patch.status } as EvalBatchRow;
    },
  };

  return { repo, insertBatchCalls, insertRunCalls, completeBatchCalls };
}

const AGENT: AgentRunConfig = {
  systemPrompt: 'Review carefully.',
  model: 'gpt-4.1',
  provider: 'openai',
};

function makeAgentCase(overrides: Partial<EvalCaseRow> = {}): EvalCaseRow {
  caseSeq += 1;
  return {
    id: `agent-case-${caseSeq}`,
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    name: `Agent case ${caseSeq}`,
    inputDiff: buildAgentCaseDiff('src/x.ts', '@@ -1,0 +1,2 @@\n+line one\n+line two'),
    inputFiles: null,
    inputMeta: null,
    expectedOutput: [],
    notes: null,
    expectationKind: 'must_not_flag',
    forbiddenRegions: null,
    inputFilename: null,
    ...overrides,
  } as EvalCaseRow;
}

describe('batch-runner — startSkillBatch (REQ-16, REQ-62, REQ-64, REQ-66)', () => {
  it('REQ-66: a batch of 2 agent cases plus a batch of 3 skill cases makes exactly 8 calls total (2 + 2×3)', async () => {
    const agentLlm = makeSequencedLlm([EMPTY_REVIEW, EMPTY_REVIEW]);
    const { repo: agentRepo } = makeRepoDouble();
    const agentDeps: BatchRunnerDeps = { repo: agentRepo, llm: async () => agentLlm.llm, parseUnifiedDiff };
    const agentParams: StartAgentBatchParams = {
      workspaceId: 'ws-1',
      ownerId: 'agent-1',
      ownerVersion: 1,
      agent: AGENT,
      cases: [makeAgentCase(), makeAgentCase()],
    };

    const skillLlm = makeSequencedLlm(new Array(6).fill(EMPTY_REVIEW));
    const { repo: skillRepo } = makeRepoDouble();
    const skillDeps: BatchRunnerDeps = { repo: skillRepo, llm: async () => skillLlm.llm, parseUnifiedDiff };
    const skillParams: StartSkillBatchParams = {
      workspaceId: 'ws-1',
      ownerId: 'skill-1',
      ownerVersion: 1,
      runnerAgentId: 'agent-1',
      runnerAgentVersion: 1,
      config: CONFIG,
      cases: [makeSkillCase(), makeSkillCase(), makeSkillCase()],
    };

    const [agentResult, skillResult] = await Promise.all([
      startAgentBatch(agentDeps, agentParams),
      startSkillBatch(skillDeps, skillParams),
    ]);
    await Promise.all([agentResult.done, skillResult.done]);

    expect(agentLlm.calls).toHaveLength(2);
    expect(skillLlm.calls).toHaveLength(6);
    expect(agentLlm.calls.length + skillLlm.calls.length).toBe(8);
  });

  it("records ownerKind 'skill' plus the resolved runner agent's id/version on the batch row", async () => {
    const { llm } = makeSequencedLlm([EMPTY_REVIEW, EMPTY_REVIEW]);
    const { repo, insertBatchCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => llm, parseUnifiedDiff };

    const { done } = await startSkillBatch(deps, {
      workspaceId: 'ws-1',
      ownerId: 'skill-1',
      ownerVersion: 4,
      runnerAgentId: 'agent-9',
      runnerAgentVersion: 2,
      config: CONFIG,
      cases: [makeSkillCase()],
    });
    await done;

    expect(insertBatchCalls).toHaveLength(1);
    expect(insertBatchCalls[0]).toMatchObject({
      ownerKind: 'skill',
      ownerId: 'skill-1',
      ownerVersion: 4,
      runnerAgentId: 'agent-9',
      runnerAgentVersion: 2,
    });
  });

  it('REQ-62: the batch aggregate reads only the with-arm pass state, never a without-arm value', async () => {
    const evalCase = makeSkillCase({
      expectedOutput: [
        {
          severity: 'WARNING',
          category: 'bug',
          title: 'Suspicious change',
          start_line: 1,
          end_line: 2,
          file: 'src/x.ts',
        },
      ],
      expectationKind: 'must_find',
    });
    // WITH arm passes (finds the expectation); WITHOUT arm would "fail" its
    // own recall (finds nothing) — if the aggregate ever read the without
    // arm, casesPassed would be 0, not 1.
    const withReview: Review = { ...EMPTY_REVIEW, findings: [findingAt('src/x.ts', 1, 2)] };
    const { llm } = makeSequencedLlm([withReview, EMPTY_REVIEW]);
    const { repo, completeBatchCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => llm, parseUnifiedDiff };

    const { done } = await startSkillBatch(deps, {
      workspaceId: 'ws-1',
      ownerId: 'skill-1',
      ownerVersion: 1,
      runnerAgentId: 'agent-1',
      runnerAgentVersion: 1,
      config: CONFIG,
      cases: [evalCase],
    });
    await done;

    expect(completeBatchCalls[0]?.patch.casesPassed).toBe(1);
    expect(completeBatchCalls[0]?.patch.casesTotal).toBe(1);
  });

  it('FIX-1/REQ-29-30-32-33-34-37-71: the batch aggregate carries the with-arm-only recall/precision/citation_accuracy, never a without-arm value', async () => {
    const evalCase = makeSkillCase({
      expectedOutput: [
        {
          severity: 'WARNING',
          category: 'bug',
          title: 'Suspicious change',
          start_line: 1,
          end_line: 2,
          file: 'src/x.ts',
        },
      ],
      expectationKind: 'must_find',
    });
    // WITH arm finds the expectation exactly (tp=1, fn=0, fp=0, kept=1,
    // dropped=0 -> recall/precision/citation_accuracy all 1). WITHOUT arm
    // finds nothing (recall 0) — if the aggregate ever folded a without-arm
    // value in, these would not all read 1.
    const withReview: Review = { ...EMPTY_REVIEW, findings: [findingAt('src/x.ts', 1, 2)] };
    const { llm } = makeSequencedLlm([withReview, EMPTY_REVIEW]);
    const { repo, completeBatchCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => llm, parseUnifiedDiff };

    const { done } = await startSkillBatch(deps, {
      workspaceId: 'ws-1',
      ownerId: 'skill-1',
      ownerVersion: 1,
      runnerAgentId: 'agent-1',
      runnerAgentVersion: 1,
      config: CONFIG,
      cases: [evalCase],
    });
    await done;

    expect(completeBatchCalls[0]?.patch.recall).toBe(1);
    expect(completeBatchCalls[0]?.patch.precision).toBe(1);
    expect(completeBatchCalls[0]?.patch.citationAccuracy).toBe(1);
  });

  it('FIX-1 + vacuous truth: a zero denominator on a batch that RAN persists a perfect 1 on all three, never 0', async () => {
    // must_not_flag, no forbidden_regions, zero findings on the with arm ->
    // tp=fn=fp=0 and kept=dropped=0 on every denominator. The case produced a
    // result, so the 2026-08-29 vacuous-truth rule applies to precision and
    // citation (nothing wrong said, nothing dropped) but never to recall.
    const { llm } = makeSequencedLlm([EMPTY_REVIEW, EMPTY_REVIEW]);
    const { repo, completeBatchCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => llm, parseUnifiedDiff };

    const { done } = await startSkillBatch(deps, {
      workspaceId: 'ws-1',
      ownerId: 'skill-1',
      ownerVersion: 1,
      runnerAgentId: 'agent-1',
      runnerAgentVersion: 1,
      config: CONFIG,
      cases: [makeSkillCase()],
    });
    await done;

    expect(completeBatchCalls[0]?.patch.recall).toBe(1);
    expect(completeBatchCalls[0]?.patch.precision).toBe(1);
    expect(completeBatchCalls[0]?.patch.citationAccuracy).toBe(1);
  });

  it('REQ-64: the persisted run carries exactly the existing eight InsertEvalRun fields — no new column', async () => {
    const { llm } = makeSequencedLlm([EMPTY_REVIEW, EMPTY_REVIEW]);
    const { repo, insertRunCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => llm, parseUnifiedDiff };

    const { done } = await startSkillBatch(deps, {
      workspaceId: 'ws-1',
      ownerId: 'skill-1',
      ownerVersion: 1,
      runnerAgentId: 'agent-1',
      runnerAgentVersion: 1,
      config: CONFIG,
      cases: [makeSkillCase()],
    });
    await done;

    expect(insertRunCalls).toHaveLength(1);
    expect(Object.keys(insertRunCalls[0]!).sort()).toEqual(
      [
        'actualOutput',
        'batchId',
        'caseId',
        'citationAccuracy',
        'costUsd',
        'durationMs',
        'pass',
        'precision',
        'recall',
      ].sort(),
    );
  });
});
