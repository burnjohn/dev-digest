import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dirname, resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EVAL_BATCH_CONCURRENCY, type LLMProvider, type Review } from '@devdigest/shared';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { buildAgentCaseDiff } from '../src/modules/_shared/diff-synth.js';
import {
  runAgentCase,
  type AgentRunConfig,
  type CaseRunnerDeps,
  type CaseRunResult,
} from '../src/modules/evals/pipeline/case-runner.js';
import {
  foldBatchAggregate,
  startAgentBatch,
  type BatchRunnerDeps,
  type StartAgentBatchParams,
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
 * T9 — the batch execution pipeline (agent-owned). SPEC-03; REQ-13
 * (execution half), REQ-16, REQ-18, REQ-19, REQ-20, REQ-28, REQ-66
 * (agent side). Hermetic: `MockLLMProvider` + an in-memory repo double, no
 * DB, no git, no GitHub — REQ-20's own claim, proved by construction (this
 * suite never imports `adapters/git/simple-git` or a GitHub client).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('modules/evals/** — CRITICAL: no import from adapters/** (onion-architecture §2, R2/R5)', () => {
  // FIX-3: this scan used to stop at `pipeline/`, which is why it did not
  // catch `routes.ts:25` importing `adapters/git/diff-parser.js` directly —
  // R5's MUST-NOT column forbids `adapters/**` exactly like R2's does.
  // Widened to walk `modules/evals/**` recursively (routes.ts, service.ts,
  // repository.ts, helpers.ts, pipeline/**, everything) so the whole module
  // is in scope, not just the one subfolder the previous finding lived in.
  function collectTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) out.push(...collectTsFiles(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('FIX-3: no file under modules/evals/** imports from adapters/**', () => {
    const evalsDir = resolve(__dirname, '../src/modules/evals');
    const files = collectTsFiles(evalsDir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      const adapterImports = src.match(/from\s+['"][^'"]*adapters\/[^'"]*['"]/g) ?? [];
      expect(adapterImports, `${file} imports from adapters/**: ${adapterImports.join(', ')}`).toEqual([]);
    }
  });
});

let caseSeq = 0;
function makeCase(overrides: Partial<EvalCaseRow> = {}): EvalCaseRow {
  caseSeq += 1;
  return {
    id: `case-${caseSeq}`,
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    name: `Case ${caseSeq}`,
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

const AGENT: AgentRunConfig = {
  systemPrompt: 'Review carefully.',
  model: 'gpt-4.1',
  provider: 'openai',
};

const PASSING_REVIEW: Review = { verdict: 'comment', summary: 'looks fine', score: 90, findings: [] };

/** In-memory double for `Pick<EvalsRepository, 'insertBatch' | 'insertRun' | 'completeBatch'>`. */
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
        casesTotal: values.casesTotal ?? null,
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

/** Wraps a `MockLLMProvider` so a concurrency violation (>1 in-flight
 * `completeStructured` call) is directly observable, not merely assumed from
 * the call log's ordering — REQ-16's "never more than one in flight". */
function withConcurrencyTracking(base: MockLLMProvider): { llm: LLMProvider; maxInFlight: () => number } {
  let inFlight = 0;
  let max = 0;
  const llm: LLMProvider = {
    id: base.id,
    listModels: (...args) => base.listModels(...args),
    complete: (...args) => base.complete(...args),
    embed: (...args) => base.embed(...args),
    completeStructured: async (req) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result = await base.completeStructured(req);
      inFlight -= 1;
      return result;
    },
  };
  return { llm, maxInFlight: () => max };
}

function baseParams(overrides: Partial<StartAgentBatchParams> = {}): StartAgentBatchParams {
  return {
    workspaceId: 'ws-1',
    ownerId: 'agent-1',
    ownerVersion: 3,
    agent: AGENT,
    cases: [],
    ...overrides,
  };
}

beforeEach(() => {
  caseSeq = 0;
});

describe('case-runner — runAgentCase (REQ-20, REQ-28, REQ-19, REQ-66)', () => {
  it('REQ-20/REQ-28: scores a normal case off its stored input_diff alone and returns all eight row values', async () => {
    const mockLlm = new MockLLMProvider('openai', { structured: PASSING_REVIEW });
    const deps: CaseRunnerDeps = { llm: async () => mockLlm, parseUnifiedDiff };
    const evalCase = makeCase();

    const result = await runAgentCase(deps, AGENT, evalCase);

    expect(result.errored).toBe(false);
    expect(result.caseId).toBe(evalCase.id);
    expect(result.values.pass).toBe(true); // must_not_flag, zero findings, zero FPs
    // Vacuous truth (2026-08-29): the case RAN, found everything there was to
    // find (nothing), said nothing wrong and dropped nothing — all three are a
    // perfect 1 rather than an unmeasured null.
    expect(result.values.recall).toBe(1);
    expect(result.values.citationAccuracy).toBe(1);
    expect(result.values.precision).toBe(1);
    expect(result.values.actualOutput).toEqual([]);
    expect(typeof result.values.durationMs).toBe('number');
    expect(result.values.costUsd).not.toBeNull();
    // REQ-20: the only outbound call is the LLM completion — nothing else was touched.
    expect(mockLlm.calls).toHaveLength(1);
    expect(mockLlm.calls[0]?.method).toBe('completeStructured');
  });

  it('REQ-19: a zero-file input_diff is errored with a stated reason and never calls the LLM', async () => {
    const mockLlm = new MockLLMProvider('openai', { structured: PASSING_REVIEW });
    const deps: CaseRunnerDeps = { llm: async () => mockLlm, parseUnifiedDiff };
    const evalCase = makeCase({ inputDiff: '' });

    const result = await runAgentCase(deps, AGENT, evalCase);

    expect(result.errored).toBe(true);
    expect(result.errorReason).toMatch(/zero files/);
    expect(result.values.pass).toBeNull();
    expect(mockLlm.calls).toHaveLength(0);
  });

  it('REQ-66: a multi-file input_diff is rejected at the same guard, never issuing a second call', async () => {
    const mockLlm = new MockLLMProvider('openai', { structured: PASSING_REVIEW });
    const deps: CaseRunnerDeps = { llm: async () => mockLlm, parseUnifiedDiff };
    const twoFileDiff = [
      buildAgentCaseDiff('a.ts', '@@ -1,0 +1,1 @@\n+one'),
      buildAgentCaseDiff('b.ts', '@@ -1,0 +1,1 @@\n+two'),
    ].join('\n');
    const evalCase = makeCase({ inputDiff: twoFileDiff });

    const result = await runAgentCase(deps, AGENT, evalCase);

    expect(result.errored).toBe(true);
    expect(result.errorReason).toMatch(/2 files/);
    expect(mockLlm.calls).toHaveLength(0);
  });

  it('a missing provider key surfaces as an errored case naming the provider', async () => {
    const deps: CaseRunnerDeps = {
      llm: async () => {
        throw new Error('OPENAI_API_KEY is not configured');
      },
      parseUnifiedDiff,
    };
    const evalCase = makeCase();

    const result = await runAgentCase(deps, AGENT, evalCase);

    expect(result.errored).toBe(true);
    expect(result.errorReason).toContain('"openai"');
    expect(result.errorReason).toContain('OPENAI_API_KEY is not configured');
  });
});

describe('batch-runner — startAgentBatch (REQ-13, REQ-16, REQ-18, REQ-19)', () => {
  it('REQ-13: start resolves before the first case completes', async () => {
    const mockLlm = new MockLLMProvider('openai', { structured: PASSING_REVIEW });
    const { repo } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => mockLlm, parseUnifiedDiff };

    const result = await startAgentBatch(deps, baseParams({ cases: [makeCase()] }));

    // The batch row exists, but the loop has not yet reached its first LLM call.
    expect(result.batchId).toBe('batch-1');
    expect(mockLlm.calls).toHaveLength(0);

    await result.done;
    expect(mockLlm.calls).toHaveLength(1);
  });

  // A client polling `GET /evals/batches/:id` needs a denominator for its
  // `scored/total` progress line, and `toBatchRecord` coalesces a NULL
  // `casesTotal` to `0` — leaving it unwritten until `completeBatch` made
  // every running batch report `n/0`.
  it('writes the size of the set on the INSERT, before a single case has run', async () => {
    const mockLlm = new MockLLMProvider('openai', { structured: PASSING_REVIEW });
    const { repo, insertBatchCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => mockLlm, parseUnifiedDiff };
    const cases = [makeCase(), makeCase(), makeCase()];

    const { done } = await startAgentBatch(deps, baseParams({ cases }));

    // Asserted BEFORE `done`: the point is that the total is known at insert.
    expect(insertBatchCalls).toHaveLength(1);
    expect(insertBatchCalls[0]?.casesTotal).toBe(3);
    await done;
  });

  // SUPERSEDES REQ-16's "at most one in flight" (owner decision 2026-08-29):
  // the pool is BOUNDED, not serial. What the requirement was protecting —
  // never an unbounded fan-out over the whole set — is what is asserted now.
  it('runs a set larger than the pool with at most EVAL_BATCH_CONCURRENCY calls in flight, each case exactly once', async () => {
    const baseLlm = new MockLLMProvider('openai', { structured: PASSING_REVIEW });
    const { llm, maxInFlight } = withConcurrencyTracking(baseLlm);
    const { repo, insertRunCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => llm, parseUnifiedDiff };
    const cases = [makeCase(), makeCase(), makeCase(), makeCase(), makeCase()];

    const { done } = await startAgentBatch(deps, baseParams({ cases }));
    await done;

    expect(baseLlm.calls).toHaveLength(5);
    expect(maxInFlight()).toBeLessThanOrEqual(EVAL_BATCH_CONCURRENCY);
    // The shared cursor is what guarantees this: five cases, five runs, no
    // case picked up by two workers.
    expect(insertRunCalls.map((r) => r.caseId).sort()).toEqual(cases.map((c) => c.id).sort());
  });

  it('a set smaller than the pool starts no idle workers and still runs every case once', async () => {
    const baseLlm = new MockLLMProvider('openai', { structured: PASSING_REVIEW });
    const { llm, maxInFlight } = withConcurrencyTracking(baseLlm);
    const { repo, insertRunCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => llm, parseUnifiedDiff };
    const cases = [makeCase(), makeCase()];

    const { done } = await startAgentBatch(deps, baseParams({ cases }));
    await done;

    expect(baseLlm.calls).toHaveLength(2);
    expect(maxInFlight()).toBeLessThanOrEqual(2);
    expect(insertRunCalls).toHaveLength(2);
  });

  it('REQ-18: all cases succeeding completes the batch as "succeeded" with finished aggregate write', async () => {
    const mockLlm = new MockLLMProvider('openai', { structured: PASSING_REVIEW });
    const { repo, completeBatchCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => mockLlm, parseUnifiedDiff };
    const cases = [makeCase(), makeCase()];

    const { done } = await startAgentBatch(deps, baseParams({ cases }));
    await done;

    expect(completeBatchCalls).toHaveLength(1);
    expect(completeBatchCalls[0]?.patch.status).toBe('succeeded');
    expect(completeBatchCalls[0]?.patch.casesTotal).toBe(2);
    expect(completeBatchCalls[0]?.patch.casesPassed).toBe(2);
  });

  it('REQ-18/REQ-19: one erroring case and one succeeding completes the batch as "partial", the error never counted as passed', async () => {
    const mockLlm = new MockLLMProvider('openai', { structured: PASSING_REVIEW });
    const { repo, completeBatchCalls, insertRunCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => mockLlm, parseUnifiedDiff };
    const cases = [makeCase({ inputDiff: '' }), makeCase()];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { done } = await startAgentBatch(deps, baseParams({ cases }));
    await done;

    expect(completeBatchCalls[0]?.patch.status).toBe('partial');
    expect(completeBatchCalls[0]?.patch.casesTotal).toBe(2);
    expect(completeBatchCalls[0]?.patch.casesPassed).toBe(1); // the errored case never counts
    expect(insertRunCalls).toHaveLength(2); // the batch continued past the error
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('errored'));
    warnSpy.mockRestore();
  });

  it('REQ-18: no case producing a result completes the batch as "failed"', async () => {
    const mockLlm = new MockLLMProvider('openai', { structured: PASSING_REVIEW });
    const { repo, completeBatchCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = { repo, llm: async () => mockLlm, parseUnifiedDiff };
    const cases = [makeCase({ inputDiff: '' }), makeCase({ inputDiff: '' })];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { done } = await startAgentBatch(deps, baseParams({ cases }));
    await done;

    expect(completeBatchCalls[0]?.patch.status).toBe('failed');
    expect(completeBatchCalls[0]?.patch.casesPassed).toBe(0);
    expect(mockLlm.calls).toHaveLength(0); // neither case ever reached the LLM
    vi.restoreAllMocks();
  });

  it('REQ-13/REQ-20: a missing provider key errors every case and ends the batch "failed", never a thrown batch', async () => {
    const { repo, completeBatchCalls } = makeRepoDouble();
    const deps: BatchRunnerDeps = {
      repo,
      llm: async () => {
        throw new Error('OPENAI_API_KEY is not configured');
      },
      parseUnifiedDiff,
    };
    const cases = [makeCase(), makeCase()];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { done } = await startAgentBatch(deps, baseParams({ cases }));
    await expect(done).resolves.toBeUndefined(); // never throws/rejects

    expect(completeBatchCalls[0]?.patch.status).toBe('failed');
    vi.restoreAllMocks();
  });
});

/**
 * `foldBatchAggregate` is the ONE place a terminal `eval_run_batches` row's
 * status + metrics are computed, shared by `runBatchLoop` (a set run) and
 * `EvalsService.runCase` (the batch of 1 an owner decision introduced on
 * 2026-08-29). Both now feed the same dashboard reads — `recent_batches`,
 * the headline cards, the trend line — so they must agree by construction,
 * not by two implementations that happen to match today.
 */
describe('foldBatchAggregate — a batch of 1 folds exactly like a batch of N', () => {
  /** How `EvalsService.persistSingleCaseRun` builds the fold input. */
  function foldOne(result: CaseRunResult) {
    return foldBatchAggregate({
      casesTotal: 1,
      casesProduced: result.errored ? 0 : 1,
      casesPassed: !result.errored && result.values.pass ? 1 : 0,
      tp: result.tally?.tp ?? 0,
      fn: result.tally?.fn ?? 0,
      fp: result.tally?.fp ?? 0,
      kept: result.grounding?.kept ?? 0,
      dropped: result.grounding?.dropped ?? 0,
      caseCosts: [{ caseId: result.caseId, costUsd: result.values.costUsd }],
    });
  }

  it('a passing case: the single-run fold equals what runBatchLoop writes for the same lone case', async () => {
    const evalCase = makeCase();
    const deps = (): BatchRunnerDeps => ({
      repo: makeRepoDouble().repo,
      llm: async () => new MockLLMProvider('openai', { structured: PASSING_REVIEW }),
      parseUnifiedDiff,
    });

    const direct = foldOne(await runAgentCase(deps(), AGENT, evalCase));

    const { repo, completeBatchCalls } = makeRepoDouble();
    const { done } = await startAgentBatch(
      { repo, llm: async () => new MockLLMProvider('openai', { structured: PASSING_REVIEW }), parseUnifiedDiff },
      baseParams({ cases: [evalCase] }),
    );
    await done;

    expect(direct).toEqual(completeBatchCalls[0]?.patch);
    expect(direct.status).toBe('succeeded');
    expect(direct.casesTotal).toBe(1);
  });

  it('vacuous truth: a lone must_not_flag case that RAN folds to a perfect 1 on all three', () => {
    const folded = foldBatchAggregate({
      casesTotal: 1,
      casesProduced: 1,
      casesPassed: 1,
      tp: 0,
      fn: 0,
      fp: 0,
      kept: 0,
      dropped: 0,
      caseCosts: [{ caseId: 'c-1', costUsd: 0.5 }],
    });

    expect(folded.status).toBe('succeeded');
    // Owner decision, 2026-08-29: a unit that RAN with no denominator scores 1
    // on all three, which is what stops the studio rendering a clean pass as
    // three em dashes. Note recall here is a CONSTANT, not a measurement — a
    // must_not_flag case has tp=fn=0 whatever the model does.
    expect(folded.recall).toBe(1);
    expect(folded.precision).toBe(1);
    expect(folded.citationAccuracy).toBe(1);
    expect(folded.costUsd).toBe(0.5);
  });

  it('an errored lone case folds to "failed" with no metrics — it can never look like a clean 0%', async () => {
    const { repo } = makeRepoDouble();
    // A zero-file diff is `case-runner`'s own errored path, no LLM involved.
    const result = await runAgentCase(
      { repo, llm: async () => new MockLLMProvider('openai', { structured: PASSING_REVIEW }), parseUnifiedDiff },
      AGENT,
      makeCase({ inputDiff: '' }),
    );

    expect(result.errored).toBe(true);
    const folded = foldOne(result);
    expect(folded.status).toBe('failed');
    expect(folded.casesPassed).toBe(0);
    // The vacuous-truth rule does NOT reach here: nothing was produced, so
    // `null` still means unmeasured. Folding this to 1 would paint a batch
    // that never ran as flawless.
    expect(folded.recall).toBeNull();
    expect(folded.precision).toBeNull();
    expect(folded.citationAccuracy).toBeNull();
  });
});
