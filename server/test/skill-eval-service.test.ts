/**
 * Unit tests for SkillEvalService + SkillEvalOrchestrator (skill-eval
 * pipeline, Step 5).
 *
 * Hermetic: no Postgres, no Docker. `SkillEvalRepository.prototype` methods
 * are stubbed via `vi.spyOn` (mirrors `test/eval-service.test.ts`'s
 * convention of stubbing the repository layer rather than hand-rolling a
 * fake Drizzle `db`), and `container` is a plain object literal exposing
 * only the members the service/orchestrator touch (`db`, `skillsRepo`,
 * `agentsRepo`, `reviewRepo`, `llm`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SkillEvalService } from '../src/modules/skills/eval-service.js';
import { SkillEvalRepository } from '../src/modules/skills/eval-repository.js';
import { ValidationError, NotFoundError } from '../src/platform/errors.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { Container } from '../src/platform/container.js';

const WS_ID = '11111111-1111-1111-1111-111111111111';
const SKILL_ID = '22222222-2222-2222-2222-222222222222';
const HOST_AGENT_ID = '66666666-6666-6666-6666-666666666666';
const PR_ID = '33333333-3333-3333-3333-333333333333';
const REVIEW_ID = '44444444-4444-4444-4444-444444444444';
const FINDING_ID = '55555555-5555-5555-5555-555555555555';

const VALID_DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,3 +10,4 @@',
  '   port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  '   redisUrl: x,',
].join('\n');

const SKILL_ROW = {
  id: SKILL_ID,
  workspaceId: WS_ID,
  name: 'No Mock Overuse',
  description: 'Flags mocking the system under test.',
  type: 'rubric' as const,
  source: 'manual' as const,
  body: 'Never mock the system under test.',
  enabled: true,
  version: 3,
  evidenceFiles: null,
  createdAt: new Date('2026-01-01'),
};

const HOST_AGENT_ROW = {
  id: HOST_AGENT_ID,
  workspaceId: WS_ID,
  name: 'General Reviewer',
  description: '',
  provider: 'openai' as const,
  model: 'gpt-4.1',
  systemPrompt: 'You are a reviewer.',
  outputSchema: null,
  strategy: 'single-pass' as const,
  ciFailOn: 'critical' as const,
  repoIntel: true,
  enabled: true,
  version: 1,
  createdBy: null,
  createdAt: new Date('2026-01-01'),
};

function makeCaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'case-1',
    workspaceId: WS_ID,
    ownerKind: 'skill' as const,
    ownerId: SKILL_ID,
    name: 'A case',
    inputDiff: VALID_DIFF,
    inputFiles: null,
    inputMeta: { source: 'manual' },
    expectedOutput: { practices: ['does X'], grounding: ['stripeKey'], threshold: 0.6 },
    notes: null,
    ...overrides,
  };
}

function makeBatchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-1',
    workspaceId: WS_ID,
    skillId: SKILL_ID,
    hostAgentId: HOST_AGENT_ID,
    kind: 'full' as const,
    status: null,
    snapshotIdentity: { skillBody: SKILL_ROW.body, skillVersion: SKILL_ROW.version, hostAgentModel: HOST_AGENT_ROW.model, hostAgentId: HOST_AGENT_ID },
    model: HOST_AGENT_ROW.model,
    judgeScore: null,
    groundingPassRate: null,
    casesPassing: null,
    casesTotal: null,
    costUsd: null,
    ranAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/** Build a minimal fake Container exposing only what the service/orchestrator use. */
function buildContainer(opts: {
  llm?: MockLLMProvider | Record<string, unknown>;
  linkedSkills?: { skill: { enabled: boolean; body: string }; order: number }[];
  skill?: typeof SKILL_ROW | undefined;
  hostAgent?: typeof HOST_AGENT_ROW | undefined;
  findingContext?: { finding: Record<string, unknown>; review: Record<string, unknown>; pull: Record<string, unknown> } | undefined;
  prFiles?: { path: string; patch: string | null }[];
}): Container {
  const llm =
    opts.llm ??
    new MockLLMProvider('openai', {
      structuredBySchema: {
        Review: { verdict: 'comment', summary: 's', score: 80, findings: [] },
      },
    });

  const container = {
    db: {} as never,
    skillsRepo: {
      getById: vi.fn().mockResolvedValue('skill' in opts ? opts.skill : SKILL_ROW),
      insertEvalCase: vi.fn(),
      updateEvalCase: vi.fn(),
      deleteEvalCase: vi.fn(),
    },
    agentsRepo: {
      getById: vi.fn().mockResolvedValue('hostAgent' in opts ? opts.hostAgent : HOST_AGENT_ROW),
      linkedSkills: vi.fn().mockResolvedValue(opts.linkedSkills ?? []),
    },
    reviewRepo: {
      findingContext: vi.fn().mockResolvedValue(opts.findingContext),
      getPrFiles: vi.fn().mockResolvedValue(opts.prFiles ?? []),
    },
    llm: vi.fn().mockResolvedValue(llm),
  };

  return container as unknown as Container;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Case-from-finding derivation (AC-4/5/6/7)
// ---------------------------------------------------------------------------

describe('SkillEvalService.createCaseFromFinding', () => {
  it('derives a positive practice + grounding key terms from an ACCEPTED finding (AC-6)', async () => {
    const container = buildContainer({
      findingContext: {
        finding: {
          id: FINDING_ID,
          reviewId: REVIEW_ID,
          file: 'src/config.ts',
          startLine: 11,
          endLine: 11,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded secret detected',
          rationale: 'Never hardcode credentials in configuration files',
          suggestion: null,
          confidence: 0.9,
          kind: 'finding',
          acceptedAt: new Date('2026-01-01'),
          dismissedAt: null,
        },
        review: { id: REVIEW_ID, agentId: HOST_AGENT_ID, prId: PR_ID },
        pull: { id: PR_ID, workspaceId: WS_ID, number: 42 },
      },
      prFiles: [{ path: 'src/config.ts', patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "x",\n   redisUrl: x,' }],
    });

    (container.skillsRepo as any).insertEvalCase.mockImplementation(async (values: any) => ({
      id: 'new-case',
      workspaceId: values.workspaceId,
      ownerKind: 'skill',
      ownerId: values.skillId,
      name: values.name,
      inputDiff: values.input_diff,
      inputFiles: null,
      inputMeta: values.input_meta,
      expectedOutput: values.expected_output,
      notes: values.notes ?? null,
    }));

    const service = new SkillEvalService(container);
    const result = await service.createCaseFromFinding(WS_ID, SKILL_ID, FINDING_ID);

    expect(result.practices).toEqual(['review output identifies the security in src/config.ts']);
    expect(result.grounding.length).toBeGreaterThan(0);
    expect(result.source).toBe('finding');
    expect(result.source_finding_id).toBe(FINDING_ID);
    expect(result.source_pr_number).toBe(42);

    const insertedArg = (container.skillsRepo as any).insertEvalCase.mock.calls[0][0];
    expect(insertedArg.skillId).toBe(SKILL_ID);
    expect(insertedArg.input_meta).toEqual({
      source: 'finding',
      source_finding_id: FINDING_ID,
      source_pr_number: 42,
    });
    // AC-5: only the finding's own file's hunk, not the whole PR diff.
    expect(insertedArg.input_diff).toContain('src/config.ts');
  });

  it('derives a NEGATIVE practice + empty grounding from a DISMISSED finding (AC-7)', async () => {
    const container = buildContainer({
      findingContext: {
        finding: {
          id: FINDING_ID,
          reviewId: REVIEW_ID,
          file: 'src/config.ts',
          startLine: 11,
          endLine: 11,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'Minor nit',
          rationale: 'Not actually a problem',
          suggestion: null,
          confidence: 0.5,
          kind: 'finding',
          acceptedAt: null,
          dismissedAt: new Date('2026-01-01'),
        },
        review: { id: REVIEW_ID, agentId: HOST_AGENT_ID, prId: PR_ID },
        pull: { id: PR_ID, workspaceId: WS_ID, number: 7 },
      },
      prFiles: [{ path: 'src/config.ts', patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "x",\n   redisUrl: x,' }],
    });

    (container.skillsRepo as any).insertEvalCase.mockImplementation(async (values: any) => ({
      id: 'new-case',
      workspaceId: values.workspaceId,
      ownerKind: 'skill',
      ownerId: values.skillId,
      name: values.name,
      inputDiff: values.input_diff,
      inputFiles: null,
      inputMeta: values.input_meta,
      expectedOutput: values.expected_output,
      notes: values.notes ?? null,
    }));

    const service = new SkillEvalService(container);
    const result = await service.createCaseFromFinding(WS_ID, SKILL_ID, FINDING_ID);

    expect(result.practices).toEqual(['review output does NOT flag src/config.ts for style']);
    expect(result.grounding).toEqual([]);
  });

  it('throws ValidationError when the finding is neither accepted nor dismissed', async () => {
    const container = buildContainer({
      findingContext: {
        finding: {
          id: FINDING_ID,
          file: 'src/config.ts',
          startLine: 11,
          endLine: 11,
          severity: 'WARNING',
          category: 'bug',
          title: 'Untriaged',
          rationale: 'r',
          suggestion: null,
          confidence: 0.5,
          kind: 'finding',
          acceptedAt: null,
          dismissedAt: null,
        },
        review: { id: REVIEW_ID, agentId: HOST_AGENT_ID, prId: PR_ID },
        pull: { id: PR_ID, workspaceId: WS_ID, number: 7 },
      },
    });

    const service = new SkillEvalService(container);
    await expect(service.createCaseFromFinding(WS_ID, SKILL_ID, FINDING_ID)).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError for a cross-workspace finding', async () => {
    const container = buildContainer({
      findingContext: {
        finding: { id: FINDING_ID, acceptedAt: new Date(), dismissedAt: null, file: 'a.ts', startLine: 1, endLine: 1, severity: 'CRITICAL', category: 'bug', title: 't', rationale: 'r', confidence: 0.5, kind: 'finding' },
        review: { id: REVIEW_ID, agentId: HOST_AGENT_ID, prId: PR_ID },
        pull: { id: PR_ID, workspaceId: 'other-workspace', number: 1 },
      },
    });

    const service = new SkillEvalService(container);
    await expect(service.createCaseFromFinding(WS_ID, SKILL_ID, FINDING_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the skill does not exist in this workspace', async () => {
    const container = buildContainer({ skill: undefined });
    const service = new SkillEvalService(container);
    await expect(service.createCaseFromFinding(WS_ID, SKILL_ID, FINDING_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when the finding\'s file has no patch to derive a diff from', async () => {
    const container = buildContainer({
      findingContext: {
        finding: {
          id: FINDING_ID,
          file: 'src/config.ts',
          startLine: 11,
          endLine: 11,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded secret',
          rationale: 'r',
          suggestion: null,
          confidence: 0.9,
          kind: 'finding',
          acceptedAt: new Date('2026-01-01'),
          dismissedAt: null,
        },
        review: { id: REVIEW_ID, agentId: HOST_AGENT_ID, prId: PR_ID },
        pull: { id: PR_ID, workspaceId: WS_ID, number: 42 },
      },
      prFiles: [{ path: 'src/config.ts', patch: null }],
    });

    const service = new SkillEvalService(container);
    await expect(service.createCaseFromFinding(WS_ID, SKILL_ID, FINDING_ID)).rejects.toThrow(ValidationError);
    expect((container.skillsRepo as any).insertEvalCase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Manual-case AC-2/AC-3 validation
// ---------------------------------------------------------------------------

describe('SkillEvalService.createCaseManual', () => {
  it('accepts a case with non-empty practices and grounding', async () => {
    const container = buildContainer({});
    (container.skillsRepo as any).insertEvalCase.mockImplementation(async (values: any) => ({
      id: 'new-case',
      workspaceId: values.workspaceId,
      ownerKind: 'skill',
      ownerId: values.skillId,
      name: values.name,
      inputDiff: values.input_diff,
      inputFiles: null,
      inputMeta: values.input_meta,
      expectedOutput: values.expected_output,
      notes: values.notes ?? null,
    }));

    const service = new SkillEvalService(container);
    const result = await service.createCaseManual(WS_ID, SKILL_ID, {
      skill_id: SKILL_ID,
      name: 'Manual case',
      fixture: VALID_DIFF,
      practices: ['does the thing'],
      grounding: ['stripeKey'],
      threshold: 0.6,
      notes: null,
    });

    expect(result.name).toBe('Manual case');
    expect((container.skillsRepo as any).insertEvalCase).toHaveBeenCalledOnce();
  });

  it('rejects an empty fixture without persisting (AC-3)', async () => {
    const container = buildContainer({});
    const service = new SkillEvalService(container);

    await expect(
      service.createCaseManual(WS_ID, SKILL_ID, {
        skill_id: SKILL_ID,
        name: 'Bad case',
        fixture: '   ',
        practices: ['does the thing'],
        grounding: [],
        threshold: 0.6,
        notes: null,
      }),
    ).rejects.toThrow(ValidationError);

    expect((container.skillsRepo as any).insertEvalCase).not.toHaveBeenCalled();
  });

  it('rejects a case with BOTH empty practices and empty grounding without persisting (AC-2)', async () => {
    const container = buildContainer({});
    const service = new SkillEvalService(container);

    await expect(
      service.createCaseManual(WS_ID, SKILL_ID, {
        skill_id: SKILL_ID,
        name: 'Bad case',
        fixture: VALID_DIFF,
        practices: [],
        grounding: [],
        threshold: 0.6,
        notes: null,
      }),
    ).rejects.toThrow(ValidationError);

    expect((container.skillsRepo as any).insertEvalCase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Full-batch run — mixed passed/failed_grounding/failed_judge
// ---------------------------------------------------------------------------

describe('SkillEvalService.runBatch — full batch, mixed outcomes', () => {
  it('scores a grounding-pass+judge-pass case as passed, a grounding-fail case as failed_grounding (skips judge), and seals status=clean', async () => {
    const casePassBoth = makeCaseRow({
      id: 'case-pass',
      expectedOutput: { practices: ['flags the secret'], grounding: ['stripekey'], threshold: 0.6 },
    });
    const caseFailsGrounding = makeCaseRow({
      id: 'case-fail-grounding',
      expectedOutput: { practices: ['flags the secret'], grounding: ['this term will never appear'], threshold: 0.6 },
    });

    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([casePassBoth, caseFailsGrounding] as any);
    const insertBatchSpy = vi.spyOn(SkillEvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow() as any);
    const insertRunSpy = vi.spyOn(SkillEvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    const updateAggSpy = vi.spyOn(SkillEvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        Review: {
          verdict: 'comment',
          summary: 's',
          score: 90,
          findings: [
            {
              id: 'f1',
              severity: 'CRITICAL',
              category: 'security',
              title: 'Hardcoded secret',
              file: 'src/config.ts',
              start_line: 11,
              end_line: 11,
              rationale: 'stripeKey is hardcoded and must be removed',
              confidence: 0.9,
            },
          ],
        },
        JudgeVerdict: {
          results: [{ practice: 'flags the secret', passed: true, evidence: 'Hardcoded secret' }],
        },
      },
    });

    const container = buildContainer({ llm });
    const service = new SkillEvalService(container);

    const result = await service.runBatch(WS_ID, SKILL_ID, HOST_AGENT_ID);

    expect(result.kind).toBe('full');
    expect(insertBatchSpy).toHaveBeenCalledOnce();
    expect(insertBatchSpy.mock.calls[0]![0]).toMatchObject({ kind: 'full', status: null, skillId: SKILL_ID, hostAgentId: HOST_AGENT_ID });
    expect(insertRunSpy).toHaveBeenCalledTimes(2);

    // case-pass: grounding passed, judge invoked and passed.
    const passRunCall = insertRunSpy.mock.calls.find((c) => (c[0] as any).caseId === 'case-pass');
    expect(passRunCall).toBeDefined();
    expect((passRunCall![0] as any).pass).toBe(true);

    // case-fail-grounding: grounding failed, judge NEVER invoked (only ONE
    // completeStructured call total — the review call — not two).
    const failGroundingRunCall = insertRunSpy.mock.calls.find((c) => (c[0] as any).caseId === 'case-fail-grounding');
    expect(failGroundingRunCall).toBeDefined();
    expect((failGroundingRunCall![0] as any).pass).toBe(false);

    const judgeCalls = llm.calls.filter((c) => (c.req as any).schemaName === 'JudgeVerdict');
    expect(judgeCalls).toHaveLength(1); // exactly one judged case, not two

    expect(updateAggSpy).toHaveBeenCalledOnce();
    const aggArg = updateAggSpy.mock.calls[0]![1];
    expect(aggArg.status).toBe('clean');
    expect(aggArg.casesTotal).toBe(2);
    expect(aggArg.casesPassing).toBe(1);

    // AC-33: the judged (passed) case's cost includes the judge LLM call's
    // cost ON TOP of the review call's; the grounding-fail case (judge never
    // ran) carries only the review cost. Both cases share the same fixture ⇒
    // same review cost, so the difference is exactly the judge call (mock:
    // 0.001) — a robust check regardless of how many review sub-calls run.
    const passCost = (passRunCall![0] as any).costUsd as number;
    const failGroundingCost = (failGroundingRunCall![0] as any).costUsd as number;
    expect(passCost).toBeGreaterThan(failGroundingCost);
    expect(passCost - failGroundingCost).toBeCloseTo(0.001, 6);

    // AC-30: the fine-grained status is persisted into actualOutput so a read
    // from history can tell failed_grounding from failed_judge.
    expect((passRunCall![0] as any).actualOutput.status).toBe('passed');
    expect((failGroundingRunCall![0] as any).actualOutput).toMatchObject({
      status: 'failed_grounding',
      grounding_missing: ['this term will never appear'],
    });
  });

  it('marks a case with grounding passed and empty practices as passed with no judge call (AC-24)', async () => {
    const caseGroundingOnly = makeCaseRow({
      id: 'case-grounding-only',
      expectedOutput: { practices: [], grounding: ['stripekey'], threshold: 0.6 },
    });

    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([caseGroundingOnly] as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow() as any);
    const insertRunSpy = vi.spyOn(SkillEvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    const updateAggSpy = vi.spyOn(SkillEvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        Review: {
          verdict: 'comment',
          summary: 's',
          score: 90,
          findings: [
            {
              id: 'f1',
              severity: 'CRITICAL',
              category: 'security',
              title: 'Hardcoded secret',
              file: 'src/config.ts',
              start_line: 11,
              end_line: 11,
              rationale: 'stripeKey is hardcoded',
              confidence: 0.9,
            },
          ],
        },
      },
    });

    const container = buildContainer({ llm });
    const service = new SkillEvalService(container);

    await service.runBatch(WS_ID, SKILL_ID, HOST_AGENT_ID);

    expect((insertRunSpy.mock.calls[0]![0] as any).pass).toBe(true);
    const judgeCalls = llm.calls.filter((c) => (c.req as any).schemaName === 'JudgeVerdict');
    expect(judgeCalls).toHaveLength(0); // AC-22: judge never runs with zero practices

    const aggArg = updateAggSpy.mock.calls[0]![1];
    expect(aggArg.casesPassing).toBe(1);
    expect(aggArg.judgeScore).toBeNull(); // no case reached judging
  });
});

// ---------------------------------------------------------------------------
// Read-back (AC-30) — persisted status distinguishes grounding vs judge from
// history, not just the live run
// ---------------------------------------------------------------------------

describe('SkillEvalService read-back (AC-30)', () => {
  const groundingRun = {
    id: 'run-g',
    caseId: 'case-g',
    ranAt: new Date('2026-01-02'),
    actualOutput: {
      status: 'failed_grounding',
      grounding_missing: ['never appears'],
      judge_score: null,
      judge_evidence: null,
    },
    pass: false,
    recall: null,
    precision: null,
    citationAccuracy: null,
    durationMs: 5,
    costUsd: 0.001,
    batchId: null,
    skillBatchId: 'batch-1',
    matchedCount: null,
    expectedCount: null,
    errorMessage: null,
  };
  const judgeRun = {
    ...groundingRun,
    id: 'run-j',
    caseId: 'case-j',
    actualOutput: {
      status: 'failed_judge',
      grounding_missing: [],
      judge_score: 0,
      judge_evidence: [{ practice: 'does X', passed: false, evidence: '' }],
    },
    costUsd: 0.002,
  };

  it('listCases maps each case to its persisted fine-grained last_run_status', async () => {
    const caseG = makeCaseRow({ id: 'case-g', name: 'grounding case' });
    const caseJ = makeCaseRow({ id: 'case-j', name: 'judge case' });
    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([caseG, caseJ] as any);
    vi.spyOn(SkillEvalRepository.prototype, 'latestRunForCase').mockImplementation(
      async (caseId: string) => (caseId === 'case-g' ? groundingRun : judgeRun) as any,
    );

    const service = new SkillEvalService(buildContainer({}));
    const items = await service.listCases(WS_ID, SKILL_ID);

    const g = items.find((i) => i.id === 'case-g')!;
    const j = items.find((i) => i.id === 'case-j')!;
    expect(g.last_run_status).toBe('failed_grounding');
    expect(g.last_run_summary).toContain('never appears');
    expect(j.last_run_status).toBe('failed_judge');
  });

  it('getBatchDetail reconstructs distinct statuses + grounding_missing + judge_evidence', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockResolvedValue(makeBatchRow() as any);
    vi.spyOn(SkillEvalRepository.prototype, 'runsForBatch').mockResolvedValue([groundingRun, judgeRun] as any);
    vi.spyOn(SkillEvalRepository.prototype, 'getCase').mockImplementation(
      async (_ws: string, caseId: string) => makeCaseRow({ id: caseId, name: caseId }) as any,
    );

    const service = new SkillEvalService(buildContainer({}));
    const detail = await service.getBatchDetail(WS_ID, 'batch-1');

    const g = detail.cases.find((c) => c.case_id === 'case-g')!;
    const j = detail.cases.find((c) => c.case_id === 'case-j')!;
    expect(g.status).toBe('failed_grounding');
    expect(g.grounding_missing).toEqual(['never appears']);
    expect(j.status).toBe('failed_judge');
    expect(j.judge_evidence).toEqual([{ practice: 'does X', passed: false, evidence: '' }]);
  });
});

// ---------------------------------------------------------------------------
// Degraded-batch path — one case's mock LLM throws
// ---------------------------------------------------------------------------

describe('SkillEvalService.runBatch — degraded path', () => {
  it('records an error outcome for the failing case, marks the batch degraded, and excludes it from aggregates', async () => {
    const caseOk = makeCaseRow({ id: 'case-ok', expectedOutput: { practices: [], grounding: [], threshold: 0.6 } });
    const caseBoom = makeCaseRow({ id: 'case-boom', expectedOutput: { practices: [], grounding: [], threshold: 0.6 } });

    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([caseOk, caseBoom] as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow() as any);
    const insertRunSpy = vi.spyOn(SkillEvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    const updateAggSpy = vi.spyOn(SkillEvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    let call = 0;
    const throwingLlm = {
      id: 'openai' as const,
      listModels: vi.fn(),
      complete: vi.fn(),
      embed: vi.fn(),
      completeStructured: vi.fn(async (req: any) => {
        call++;
        if (call === 2) throw new Error('provider timeout');
        return {
          data: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
          model: req.model,
          tokensIn: 10,
          tokensOut: 5,
          costUsd: 0.001,
          raw: '{}',
          attempts: 1,
        };
      }),
    };

    const container = buildContainer({ llm: throwingLlm });
    const service = new SkillEvalService(container);

    const result = await service.runBatch(WS_ID, SKILL_ID, HOST_AGENT_ID);

    expect(result.status).toBe('degraded');
    expect(insertRunSpy).toHaveBeenCalledTimes(2);
    const errorRunCall = insertRunSpy.mock.calls.find((c) => (c[0] as any).pass === null);
    expect(errorRunCall).toBeDefined();
    expect((errorRunCall![0] as any).errorMessage).toContain('provider timeout');

    const aggArg = updateAggSpy.mock.calls[0]![1];
    expect(aggArg.status).toBe('degraded');
    expect(aggArg.casesTotal).toBe(2); // total includes the errored case
    expect(aggArg.casesPassing).toBe(1); // but passing/grounding/judge exclude it
  });
});

// ---------------------------------------------------------------------------
// Full-batch run — aggregate math with judged + grounding-only + errored cases
// combined in ONE batch (AC-25/AC-26/AC-33)
// ---------------------------------------------------------------------------

describe('SkillEvalService.runBatch — aggregate math with a mix of judged, grounding-only, and errored cases', () => {
  it('averages judge_score only over judged cases, computes grounding_pass_rate over non-errored cases, and sums cost only for non-errored cases', async () => {
    // Three distinct cases, each routed to a distinct file path in its own
    // diff so the LLM mock can identify which case is being scored from the
    // request content alone — robust regardless of concurrency/call-order
    // (CONCURRENCY=3 runs all three cases' `runOneCase` truly in parallel, so
    // a global call-counter trick like the single-case degraded-path test
    // uses is not reliable here).
    // Mirrors VALID_DIFF's exact hunk shape (module-level constant, above):
    // `@@ -10,3 +10,4 @@` with the added line landing at new-side line 11 —
    // required so `groundFindings()` (reviewer-core) doesn't drop the
    // synthetic finding for citing a line outside any diff hunk.
    const diffFor = (path: string) =>
      [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        '@@ -10,3 +10,4 @@',
        '   port: 3000,',
        `+  marker: "${path}",`,
        '   redisUrl: x,',
      ].join('\n');

    const caseJudged = makeCaseRow({
      id: 'case-judged',
      inputDiff: diffFor('src/judged.ts'),
      expectedOutput: { practices: ['flags the secret'], grounding: ['judged-term'], threshold: 0.6 },
    });
    const caseGroundingOnly = makeCaseRow({
      id: 'case-grounding-only',
      inputDiff: diffFor('src/grounding-only.ts'),
      expectedOutput: { practices: [], grounding: ['grounding-only-term'], threshold: 0.6 },
    });
    const caseErrored = makeCaseRow({
      id: 'case-errored',
      inputDiff: diffFor('src/errored.ts'),
      expectedOutput: { practices: ['flags the secret'], grounding: ['errored-term'], threshold: 0.6 },
    });

    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([
      caseJudged,
      caseGroundingOnly,
      caseErrored,
    ] as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow() as any);
    const insertRunSpy = vi.spyOn(SkillEvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    const updateAggSpy = vi.spyOn(SkillEvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const containsPath = (req: unknown, needle: string): boolean => {
      const messages = (req as { messages?: { content: string }[] }).messages ?? [];
      return messages.some((m) => m.content.includes(needle));
    };

    const llm = {
      id: 'openai' as const,
      listModels: vi.fn(),
      complete: vi.fn(),
      embed: vi.fn(),
      completeStructured: vi.fn(async (req: any) => {
        if (req.schemaName === 'Review' && containsPath(req, 'src/errored.ts')) {
          throw new Error('provider timeout');
        }
        if (req.schemaName === 'Review') {
          // Each review call reports the SAME cost so per-case cost deltas
          // below are attributable purely to whether a judge call ran.
          const path = containsPath(req, 'src/judged.ts')
            ? 'src/judged.ts'
            : containsPath(req, 'src/grounding-only.ts')
              ? 'src/grounding-only.ts'
              : 'src/errored.ts';
          const term = path === 'src/judged.ts' ? 'judged-term' : 'grounding-only-term';
          return {
            data: {
              verdict: 'comment',
              summary: 's',
              score: 90,
              findings: [
                {
                  id: 'f1',
                  severity: 'CRITICAL',
                  category: 'security',
                  title: 'Marker finding',
                  file: path,
                  start_line: 11,
                  end_line: 11,
                  rationale: `mentions ${term} explicitly`,
                  confidence: 0.9,
                },
              ],
            },
            model: req.model,
            tokensIn: 10,
            tokensOut: 5,
            costUsd: 0.01,
            raw: '{}',
            attempts: 1,
          };
        }
        // JudgeVerdict call — only case-judged has non-empty practices, so
        // this only ever fires for that one case.
        return {
          data: { results: [{ practice: 'flags the secret', passed: true, evidence: 'mentions judged-term' }] },
          model: req.model,
          tokensIn: 10,
          tokensOut: 5,
          costUsd: 0.002,
          raw: '{}',
          attempts: 1,
        };
      }),
    };

    const container = buildContainer({ llm: llm as any });
    const service = new SkillEvalService(container);

    const result = await service.runBatch(WS_ID, SKILL_ID, HOST_AGENT_ID);

    expect(result.status).toBe('degraded'); // one case errored
    expect(insertRunSpy).toHaveBeenCalledTimes(3);

    const judgeCalls = (llm.completeStructured as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[0] as any).schemaName === 'JudgeVerdict',
    );
    expect(judgeCalls).toHaveLength(1); // only the judged case reaches the judge

    const aggArg = updateAggSpy.mock.calls[0]![1];

    // casesTotal includes the errored case; casesPassing does not.
    expect(aggArg.casesTotal).toBe(3);
    expect(aggArg.casesPassing).toBe(2); // judged-pass + grounding-only-pass

    // judge_score averages ONLY over the one judged case (score 1.0) — not
    // diluted by the grounding-only case (never reached judging) or the
    // errored case (excluded entirely).
    expect(aggArg.judgeScore).toBe(1);

    // grounding_pass_rate is computed over NON-ERRORED cases only (2), both
    // of which passed grounding → 1, not 2/3.
    expect(aggArg.groundingPassRate).toBe(1);

    // cost_usd sums review+judge cost for non-errored cases only: the judged
    // case contributes review(0.01) + judge(0.002) = 0.012; the
    // grounding-only case contributes review(0.01) only; the errored case
    // contributes nothing (its review call threw before any cost was
    // reported). Total = 0.022, NOT inflated by the errored case's would-be
    // cost.
    expect(aggArg.costUsd).toBeCloseTo(0.022, 6);

    // Read-back sanity: the errored run is persisted with pass=null and an
    // error message, so history can distinguish it from a scored failure.
    const erroredRunCall = insertRunSpy.mock.calls.find((c) => (c[0] as any).caseId === 'case-errored');
    expect(erroredRunCall).toBeDefined();
    expect((erroredRunCall![0] as any).pass).toBeNull();
    expect((erroredRunCall![0] as any).errorMessage).toContain('provider timeout');
  });
});

// ---------------------------------------------------------------------------
// Snapshot identity (AC-17) — differs on host-agent change OR skill-version
// change, never derived from the skill body alone
// ---------------------------------------------------------------------------

describe('SkillEvalService.startEvalRun — snapshot identity (AC-17)', () => {
  it('produces a different snapshot_identity when only the host agent differs (same skill/version)', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    const insertBatchSpy = vi
      .spyOn(SkillEvalRepository.prototype, 'insertBatch')
      .mockImplementation(async (values: any) => makeBatchRow({ snapshotIdentity: values.snapshotIdentity }) as any);

    const otherHostAgent = { ...HOST_AGENT_ROW, id: 'other-host-agent-id', model: 'claude-haiku-4.5' };

    const containerA = buildContainer({});
    const serviceA = new SkillEvalService(containerA);
    const startedA = await serviceA.startEvalRun(WS_ID, SKILL_ID, HOST_AGENT_ID);

    const containerB = buildContainer({ hostAgent: otherHostAgent });
    const serviceB = new SkillEvalService(containerB);
    const startedB = await serviceB.startEvalRun(WS_ID, SKILL_ID, otherHostAgent.id);

    expect(insertBatchSpy).toHaveBeenCalledTimes(2);
    const identityA = insertBatchSpy.mock.calls[0]![0].snapshotIdentity as Record<string, unknown>;
    const identityB = insertBatchSpy.mock.calls[1]![0].snapshotIdentity as Record<string, unknown>;

    expect(identityA).not.toEqual(identityB);
    expect(identityA.hostAgentId).toBe(HOST_AGENT_ID);
    expect(identityB.hostAgentId).toBe(otherHostAgent.id);
    expect(identityB.hostAgentModel).toBe('claude-haiku-4.5');
    // Both share the SAME skill body/version — the divergence is attributable
    // entirely to the host agent, not a coincidental skill-side difference.
    expect(identityA.skillBody).toBe(identityB.skillBody);
    expect(identityA.skillVersion).toBe(identityB.skillVersion);

    void startedA;
    void startedB;
  });

  it('produces a different snapshot_identity when the skill version bumps (same host agent)', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([makeCaseRow()] as any);
    const insertBatchSpy = vi
      .spyOn(SkillEvalRepository.prototype, 'insertBatch')
      .mockImplementation(async (values: any) => makeBatchRow({ snapshotIdentity: values.snapshotIdentity }) as any);

    const bumpedSkill = { ...SKILL_ROW, version: SKILL_ROW.version + 1 };

    const containerV1 = buildContainer({});
    const serviceV1 = new SkillEvalService(containerV1);
    await serviceV1.startEvalRun(WS_ID, SKILL_ID, HOST_AGENT_ID);

    const containerV2 = buildContainer({ skill: bumpedSkill });
    const serviceV2 = new SkillEvalService(containerV2);
    await serviceV2.startEvalRun(WS_ID, SKILL_ID, HOST_AGENT_ID);

    expect(insertBatchSpy).toHaveBeenCalledTimes(2);
    const identityV1 = insertBatchSpy.mock.calls[0]![0].snapshotIdentity as Record<string, unknown>;
    const identityV2 = insertBatchSpy.mock.calls[1]![0].snapshotIdentity as Record<string, unknown>;

    expect(identityV1).not.toEqual(identityV2);
    expect(identityV1.skillVersion).toBe(SKILL_ROW.version);
    expect(identityV2.skillVersion).toBe(SKILL_ROW.version + 1);
    // Same host agent both times — the divergence is attributable entirely to
    // the skill version bump.
    expect(identityV1.hostAgentId).toBe(identityV2.hostAgentId);
    expect(identityV1.hostAgentModel).toBe(identityV2.hostAgentModel);
  });
});

// ---------------------------------------------------------------------------
// Calibration-batch kind detection
// ---------------------------------------------------------------------------

describe('SkillEvalService.runBatch — calibration kind detection', () => {
  it('marks a strict subset of a multi-case set as a calibration batch', async () => {
    const caseA = makeCaseRow({ id: 'case-a', expectedOutput: { practices: [], grounding: [], threshold: 0.6 } });
    const caseB = makeCaseRow({ id: 'case-b', expectedOutput: { practices: [], grounding: [], threshold: 0.6 } });

    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([caseA, caseB] as any);
    const insertBatchSpy = vi
      .spyOn(SkillEvalRepository.prototype, 'insertBatch')
      .mockResolvedValue(makeBatchRow({ kind: 'calibration' }) as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    vi.spyOn(SkillEvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const container = buildContainer({});
    const service = new SkillEvalService(container);

    const result = await service.runBatch(WS_ID, SKILL_ID, HOST_AGENT_ID, ['case-a']);

    expect(result.kind).toBe('calibration');
    expect(insertBatchSpy.mock.calls[0]![0]).toMatchObject({ kind: 'calibration' });
    // A calibration batch is ALWAYS sealed with a real clean/degraded status
    // (never left null) — the client polls `status != null` as the
    // completion signal.
    expect(result.status).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Marginal-contribution skill-append + zero-linked-skills edge case (AC-13)
// ---------------------------------------------------------------------------

describe('SkillEvalService.runBatch — marginal contribution', () => {
  it('appends the skill-under-test to the host agent\'s OWN existing linked skills (never replacing them)', async () => {
    const theCase = makeCaseRow({ id: 'case-1', expectedOutput: { practices: [], grounding: [], threshold: 0.6 } });
    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([theCase] as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow() as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    vi.spyOn(SkillEvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { Review: { verdict: 'comment', summary: 's', score: 90, findings: [] } },
    });

    const container = buildContainer({
      llm,
      linkedSkills: [
        { skill: { enabled: true, body: 'Host agent existing skill A body.' }, order: 0 },
        { skill: { enabled: false, body: 'Disabled skill body — must be excluded.' }, order: 1 },
      ],
    });

    const service = new SkillEvalService(container);
    await service.runBatch(WS_ID, SKILL_ID, HOST_AGENT_ID);

    const reviewCall = llm.calls.find((c) => (c.req as any).schemaName === 'Review');
    expect(reviewCall).toBeDefined();
    // The prompt assembly is opaque here (messages, not raw skills[]), so we
    // instead assert via the orchestrator's own resolved skillBodies by
    // spying on startBatch's return — simplest: re-run startBatch directly.
    const started = await service.startEvalRun(WS_ID, SKILL_ID, HOST_AGENT_ID);
    expect(started.skillBodies).toContain('Host agent existing skill A body.');
    expect(started.skillBodies).toContain(SKILL_ROW.body); // skill-under-test appended
    expect(started.skillBodies).not.toContain('Disabled skill body — must be excluded.');
    expect(started.skillBodies[started.skillBodies.length - 1]).toBe(SKILL_ROW.body); // appended, not prepended
  });

  it('proceeds with only the skill-under-test when the host agent has zero linked skills (not an error)', async () => {
    const theCase = makeCaseRow({ id: 'case-1', expectedOutput: { practices: [], grounding: [], threshold: 0.6 } });
    vi.spyOn(SkillEvalRepository.prototype, 'listCases').mockResolvedValue([theCase] as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertBatch').mockResolvedValue(makeBatchRow() as any);
    vi.spyOn(SkillEvalRepository.prototype, 'insertRun').mockResolvedValue({} as any);
    vi.spyOn(SkillEvalRepository.prototype, 'updateBatchAggregate').mockResolvedValue(undefined);

    const container = buildContainer({ linkedSkills: [] });
    const service = new SkillEvalService(container);

    const started = await service.startEvalRun(WS_ID, SKILL_ID, HOST_AGENT_ID);
    expect(started.skillBodies).toEqual([SKILL_ROW.body]);

    // Full run must not throw despite zero other linked skills.
    await expect(service.runBatch(WS_ID, SKILL_ID, HOST_AGENT_ID)).resolves.toMatchObject({ status: 'clean' });
  });
});

// ---------------------------------------------------------------------------
// startEvalRun — 404s (skill / host agent)
// ---------------------------------------------------------------------------

describe('SkillEvalService.startEvalRun', () => {
  it('throws NotFoundError when the skill does not exist in this workspace', async () => {
    const container = buildContainer({ skill: undefined });
    const service = new SkillEvalService(container);
    await expect(service.startEvalRun(WS_ID, SKILL_ID, HOST_AGENT_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when the host agent does not exist in this workspace', async () => {
    const container = buildContainer({ hostAgent: undefined });
    const service = new SkillEvalService(container);
    await expect(service.startEvalRun(WS_ID, SKILL_ID, HOST_AGENT_ID)).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// updateCase — AC-2/AC-3 + threshold defense-in-depth
// ---------------------------------------------------------------------------

describe('SkillEvalService.updateCase', () => {
  it('persists a valid edit', async () => {
    const container = buildContainer({});
    (container.skillsRepo as any).updateEvalCase.mockResolvedValue({
      id: 'case-1',
      workspaceId: WS_ID,
      ownerKind: 'skill',
      ownerId: SKILL_ID,
      name: 'Updated',
      inputDiff: VALID_DIFF,
      inputFiles: null,
      inputMeta: { source: 'manual' },
      expectedOutput: { practices: ['p'], grounding: [], threshold: 0.5 },
      notes: null,
    });

    const service = new SkillEvalService(container);
    const result = await service.updateCase(WS_ID, SKILL_ID, 'case-1', {
      skill_id: SKILL_ID,
      name: 'Updated',
      fixture: VALID_DIFF,
      practices: ['p'],
      grounding: [],
      threshold: 0.5,
      notes: null,
    });

    expect(result.name).toBe('Updated');
  });

  it('rejects a case missing both practices and grounding', async () => {
    const container = buildContainer({});
    const service = new SkillEvalService(container);
    await expect(
      service.updateCase(WS_ID, SKILL_ID, 'case-1', {
        skill_id: SKILL_ID,
        name: 'Updated',
        fixture: VALID_DIFF,
        practices: [],
        grounding: [],
        threshold: 0.5,
        notes: null,
      }),
    ).rejects.toThrow(ValidationError);
    expect((container.skillsRepo as any).updateEvalCase).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the case does not resolve (unknown/cross-skill)', async () => {
    const container = buildContainer({});
    (container.skillsRepo as any).updateEvalCase.mockResolvedValue(undefined);
    const service = new SkillEvalService(container);
    await expect(
      service.updateCase(WS_ID, SKILL_ID, 'missing-case', {
        skill_id: SKILL_ID,
        name: 'Updated',
        fixture: VALID_DIFF,
        practices: ['p'],
        grounding: [],
        threshold: 0.5,
        notes: null,
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// getTrend / compareBatches / getKpiDelta / clearHistory — ported from the
// agent-eval pipeline's precedent (test/eval-service.test.ts), reversing this
// feature's original spec Non-goals at the user's explicit request.
// ---------------------------------------------------------------------------

function makeTrendBatchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-1',
    workspaceId: WS_ID,
    skillId: SKILL_ID,
    hostAgentId: HOST_AGENT_ID,
    kind: 'full' as const,
    status: 'clean' as const,
    snapshotIdentity: { skillBody: 'x', skillVersion: 1, hostAgentModel: 'gpt-4.1', hostAgentId: HOST_AGENT_ID },
    model: 'gpt-4.1',
    judgeScore: 0.8,
    groundingPassRate: 1,
    casesPassing: 4,
    casesTotal: 5,
    costUsd: 0.05,
    ranAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('SkillEvalService.getTrend', () => {
  it('filters out batches with any null/zero-total metric and reverses to chronological order', async () => {
    const oldest = makeTrendBatchRow({ id: 'batch-oldest', ranAt: new Date('2026-07-01T00:00:00Z') });
    const noSignal = makeTrendBatchRow({
      id: 'batch-no-signal',
      ranAt: new Date('2026-07-02T00:00:00Z'),
      judgeScore: null,
      groundingPassRate: null,
      casesPassing: null,
      casesTotal: null,
    });
    const zeroTotal = makeTrendBatchRow({
      id: 'batch-zero-total',
      ranAt: new Date('2026-07-03T00:00:00Z'),
      casesTotal: 0,
      casesPassing: 0,
    });
    const newest = makeTrendBatchRow({ id: 'batch-newest', ranAt: new Date('2026-07-04T00:00:00Z') });

    // repo.listTrendBatches returns newest-first (desc ran_at) per its own contract.
    vi.spyOn(SkillEvalRepository.prototype, 'listTrendBatches').mockResolvedValue(
      [newest, zeroTotal, noSignal, oldest] as any,
    );

    const service = new SkillEvalService(buildContainer({}));
    const points = await service.getTrend(WS_ID, SKILL_ID);

    // No-signal and zero-total batches excluded entirely — never rendered as
    // a fake 0%/0%/0% dip.
    expect(points.map((p) => p.batch_id)).toEqual(['batch-oldest', 'batch-newest']);
    expect(points[0]!.judge_score).toBe(0.8);
    expect(points[0]!.grounding_pass_rate).toBe(1);
    expect(points[0]!.cases_passing_rate).toBeCloseTo(0.8, 6); // 4/5
    expect(points[0]!.is_degraded).toBe(false);
    expect(points[0]!.cost_usd).toBe(0.05);
  });

  it('marks is_degraded true for a degraded batch', async () => {
    const degraded = makeTrendBatchRow({ status: 'degraded' });
    vi.spyOn(SkillEvalRepository.prototype, 'listTrendBatches').mockResolvedValue([degraded] as any);

    const service = new SkillEvalService(buildContainer({}));
    const points = await service.getTrend(WS_ID, SKILL_ID);
    expect(points[0]!.is_degraded).toBe(true);
  });

  it('returns an empty array when there are no full sealed batches', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'listTrendBatches').mockResolvedValue([]);
    const service = new SkillEvalService(buildContainer({}));
    expect(await service.getTrend(WS_ID, SKILL_ID)).toEqual([]);
  });
});

describe('SkillEvalService.compareBatches', () => {
  function makeDetail(overrides: Record<string, unknown> = {}) {
    return {
      id: 'batch-x',
      skill_id: SKILL_ID,
      host_agent_id: HOST_AGENT_ID,
      kind: 'full' as const,
      status: 'clean' as const,
      snapshot_identity: {},
      model: 'gpt-4.1',
      judge_score: 0.8,
      grounding_pass_rate: 1,
      cases_passing: 4,
      cases_total: 5,
      cost_usd: 0.05,
      ran_at: '2026-07-01T00:00:00.000Z',
      cases: [],
      ...overrides,
    };
  }

  it('computes deltas between two fully-scored batches', async () => {
    const a = makeDetail({ id: 'batch-a', judge_score: 0.6, grounding_pass_rate: 0.8, cases_passing: 2, cases_total: 5 });
    const b = makeDetail({ id: 'batch-b', judge_score: 0.9, grounding_pass_rate: 1, cases_passing: 4, cases_total: 5 });

    vi.spyOn(SkillEvalService.prototype, 'getBatchDetail')
      .mockResolvedValueOnce(a as any)
      .mockResolvedValueOnce(b as any);

    const service = new SkillEvalService(buildContainer({}));
    const result = await service.compareBatches(WS_ID, 'batch-a', 'batch-b');

    expect(result.a.id).toBe('batch-a');
    expect(result.b.id).toBe('batch-b');
    expect(result.deltas.judge_score).toBeCloseTo(0.3, 6);
    expect(result.deltas.grounding_pass_rate).toBeCloseTo(0.2, 6);
    expect(result.deltas.cases_passing_rate).toBeCloseTo(0.8 - 0.4, 6); // 4/5 - 2/5
  });

  it('throws ValidationError when batch A has a null metric', async () => {
    const a = makeDetail({ id: 'batch-a', judge_score: null });
    const b = makeDetail({ id: 'batch-b' });

    vi.spyOn(SkillEvalService.prototype, 'getBatchDetail')
      .mockResolvedValueOnce(a as any)
      .mockResolvedValueOnce(b as any);

    const service = new SkillEvalService(buildContainer({}));
    await expect(service.compareBatches(WS_ID, 'batch-a', 'batch-b')).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when batch B has cases_total null/zero (no signal)', async () => {
    const a = makeDetail({ id: 'batch-a' });
    const b = makeDetail({ id: 'batch-b', cases_total: 0, cases_passing: 0 });

    vi.spyOn(SkillEvalService.prototype, 'getBatchDetail')
      .mockResolvedValueOnce(a as any)
      .mockResolvedValueOnce(b as any);

    const service = new SkillEvalService(buildContainer({}));
    await expect(service.compareBatches(WS_ID, 'batch-a', 'batch-b')).rejects.toThrow(ValidationError);
  });
});

describe('SkillEvalService.getKpiDelta', () => {
  it('returns null when there is no previous full batch (no baseline)', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockResolvedValue(makeTrendBatchRow({ id: 'latest' }) as any);
    vi.spyOn(SkillEvalRepository.prototype, 'previousFullBatch').mockResolvedValue(null);

    const service = new SkillEvalService(buildContainer({}));
    expect(await service.getKpiDelta(WS_ID, SKILL_ID, 'latest')).toBeNull();
  });

  it('returns null (not a thrown error) when either side has a null metric', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockResolvedValue(
      makeTrendBatchRow({ id: 'latest', judgeScore: null }) as any,
    );
    vi.spyOn(SkillEvalRepository.prototype, 'previousFullBatch').mockResolvedValue(
      makeTrendBatchRow({ id: 'previous' }) as any,
    );

    const service = new SkillEvalService(buildContainer({}));
    const result = await service.getKpiDelta(WS_ID, SKILL_ID, 'latest');
    expect(result).toBeNull();
  });

  it('returns null when the baseline has cases_total null/zero', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockResolvedValue(makeTrendBatchRow({ id: 'latest' }) as any);
    vi.spyOn(SkillEvalRepository.prototype, 'previousFullBatch').mockResolvedValue(
      makeTrendBatchRow({ id: 'previous', casesTotal: 0, casesPassing: 0 }) as any,
    );

    const service = new SkillEvalService(buildContainer({}));
    expect(await service.getKpiDelta(WS_ID, SKILL_ID, 'latest')).toBeNull();
  });

  it('computes the 3-field delta vs. the previous full batch', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockResolvedValue(
      makeTrendBatchRow({ id: 'latest', judgeScore: 0.9, groundingPassRate: 1, casesPassing: 5, casesTotal: 5 }) as any,
    );
    vi.spyOn(SkillEvalRepository.prototype, 'previousFullBatch').mockResolvedValue(
      makeTrendBatchRow({ id: 'previous', judgeScore: 0.7, groundingPassRate: 0.8, casesPassing: 3, casesTotal: 5 }) as any,
    );

    const service = new SkillEvalService(buildContainer({}));
    const result = await service.getKpiDelta(WS_ID, SKILL_ID, 'latest');

    expect(result).not.toBeNull();
    expect(result!.judge_score).toBeCloseTo(0.2, 6);
    expect(result!.grounding_pass_rate).toBeCloseTo(0.2, 6);
    expect(result!.cases_passing_rate).toBeCloseTo(1 - 0.6, 6); // 5/5 - 3/5
  });

  it('throws NotFoundError when the latest batch id does not resolve', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'getBatch').mockResolvedValue(null);
    const service = new SkillEvalService(buildContainer({}));
    await expect(service.getKpiDelta(WS_ID, SKILL_ID, 'unknown-batch')).rejects.toThrow(NotFoundError);
  });
});

describe('SkillEvalService.clearHistory', () => {
  it('404s on an unknown/cross-workspace skill', async () => {
    const container = buildContainer({ skill: undefined });
    const clearHistorySpy = vi.spyOn(SkillEvalRepository.prototype, 'clearHistory');

    const service = new SkillEvalService(container);
    await expect(service.clearHistory(WS_ID, SKILL_ID)).rejects.toThrow(NotFoundError);
    expect(clearHistorySpy).not.toHaveBeenCalled();
  });

  it('delegates to the repository and returns the snake_case DTO', async () => {
    vi.spyOn(SkillEvalRepository.prototype, 'clearHistory').mockResolvedValue({
      deletedBatches: 3,
      deletedRuns: 12,
    });

    const container = buildContainer({});
    const service = new SkillEvalService(container);
    const result = await service.clearHistory(WS_ID, SKILL_ID);

    expect(result).toEqual({ deleted_batches: 3, deleted_runs: 12 });
  });
});
