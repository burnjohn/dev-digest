import { describe, it, expect, vi } from 'vitest';
import type { EvalCaseMeta, EvalExpectation } from '@devdigest/shared';
import { AppError, ConfigError, NotFoundError } from '../../platform/errors.js';
import { EvalService } from './service.js';
import type {
  CarrierForSkill,
  EvalCaseRow,
  EvalRunRow,
  FindingForCase,
  InjectedSkillForFinding,
  SkillForEval,
} from './repository.js';
import type { AgentRecord, LinkedSkillForRun } from './ports.js';

/**
 * A hand-written fake satisfying `EvalRepository`'s public surface
 * structurally — no DB, no testcontainers. Mirrors the onion-architecture
 * skill's "inject fake ports" guidance for application-service tests.
 */
class FakeEvalRepository {
  cases = new Map<string, EvalCaseRow>();
  runs = new Map<string, EvalRunRow>();
  findings = new Map<string, FindingForCase>();
  filePatches = new Map<string, string | null>();
  agentVersionPrompts = new Map<string, string>();
  private caseSeq = 0;
  private runSeq = 0;

  async findingForCase(workspaceId: string, findingId: string): Promise<FindingForCase | undefined> {
    void workspaceId;
    return this.findings.get(findingId);
  }

  async getCaseBySourceFindingForOwner(
    workspaceId: string,
    findingId: string,
    ownerKind: string,
    ownerId: string,
  ): Promise<EvalCaseRow | undefined> {
    void workspaceId;
    return [...this.cases.values()].find(
      (c) => c.sourceFindingId === findingId && c.ownerKind === ownerKind && c.ownerId === ownerId,
    );
  }

  async filePatch(prId: string, path: string): Promise<string | null | undefined> {
    return this.filePatches.get(`${prId}:${path}`);
  }

  async agentVersionPrompt(agentId: string, version: number): Promise<string | undefined> {
    return this.agentVersionPrompts.get(`${agentId}:${version}`);
  }

  async insertCase(values: {
    workspaceId: string;
    ownerKind: 'skill' | 'agent';
    ownerId: string;
    name: string;
    inputDiff: string;
    inputFiles: string[];
    inputMeta: EvalCaseMeta;
    expectation: EvalExpectation;
    notes?: string | null;
    sourceFindingId?: string | null;
  }): Promise<EvalCaseRow> {
    if (values.sourceFindingId) {
      const clash = await this.getCaseBySourceFindingForOwner(
        values.workspaceId,
        values.sourceFindingId,
        values.ownerKind,
        values.ownerId,
      );
      if (clash) {
        const err = new Error('duplicate key value violates unique constraint');
        (err as { code?: string }).code = '23505';
        throw err;
      }
    }
    const id = `case-${++this.caseSeq}`;
    const now = new Date();
    const row: EvalCaseRow = {
      id,
      workspaceId: values.workspaceId,
      ownerKind: values.ownerKind,
      ownerId: values.ownerId,
      name: values.name,
      inputDiff: values.inputDiff,
      inputFiles: values.inputFiles,
      inputMeta: values.inputMeta,
      expectedOutput: values.expectation,
      notes: values.notes ?? null,
      sourceFindingId: values.sourceFindingId ?? null,
      createdAt: now,
      updatedAt: now,
    } as EvalCaseRow;
    this.cases.set(id, row);
    return row;
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const row = this.cases.get(id);
    return row?.workspaceId === workspaceId ? row : undefined;
  }

  async listCasesForOwner(workspaceId: string, ownerKind: string, ownerId: string): Promise<EvalCaseRow[]> {
    return [...this.cases.values()].filter(
      (c) => c.workspaceId === workspaceId && c.ownerKind === ownerKind && c.ownerId === ownerId,
    );
  }

  async getCasesByIds(workspaceId: string, ids: string[]): Promise<EvalCaseRow[]> {
    const idSet = new Set(ids);
    return [...this.cases.values()].filter((c) => c.workspaceId === workspaceId && idSet.has(c.id));
  }

  async updateCase(workspaceId: string, id: string, patch: Record<string, unknown>): Promise<EvalCaseRow | undefined> {
    const row = await this.getCase(workspaceId, id);
    if (!row) return undefined;
    const updated = { ...row, ...patch, updatedAt: new Date() } as EvalCaseRow;
    if ('expectation' in patch) updated.expectedOutput = patch.expectation as EvalExpectation;
    this.cases.set(id, updated);
    return updated;
  }

  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const row = await this.getCase(workspaceId, id);
    if (!row) return false;
    this.cases.delete(id);
    return true;
  }

  async deleteForOwner(workspaceId: string, ownerKind: string, ownerId: string): Promise<void> {
    for (const [id, row] of this.cases) {
      if (row.workspaceId === workspaceId && row.ownerKind === ownerKind && row.ownerId === ownerId) {
        this.cases.delete(id);
      }
    }
    for (const [id, row] of this.runs) {
      if (row.workspaceId === workspaceId && row.ownerKind === ownerKind && row.ownerId === ownerId) {
        this.runs.delete(id);
      }
    }
  }

  async insertRun(values: {
    workspaceId: string;
    ownerKind: 'skill' | 'agent';
    ownerId: string;
    agentVersion: number | null;
    caseIds: string[];
    skillVersion?: number | null;
    carrierAgentId?: string | null;
    gatesBypassed?: boolean;
  }): Promise<EvalRunRow> {
    const id = `run-${++this.runSeq}`;
    const row: EvalRunRow = {
      id,
      workspaceId: values.workspaceId,
      ownerKind: values.ownerKind,
      ownerId: values.ownerId,
      ranAt: new Date(),
      status: 'running',
      agentVersion: values.agentVersion,
      caseIds: values.caseIds,
      perCase: [],
      casesErrored: 0,
      tracesPassed: null,
      tracesTotal: null,
      finishedAt: null,
      errorReason: null,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: null,
      costUsd: null,
      skillVersion: values.skillVersion ?? null,
      carrierAgentId: values.carrierAgentId ?? null,
      gatesBypassed: values.gatesBypassed ?? false,
      armWithout: null,
    } as EvalRunRow;
    this.runs.set(id, row);
    return row;
  }

  async getRun(workspaceId: string, id: string): Promise<EvalRunRow | undefined> {
    const row = this.runs.get(id);
    return row?.workspaceId === workspaceId ? row : undefined;
  }

  async listRunsForOwner(workspaceId: string, ownerKind: string, ownerId: string): Promise<EvalRunRow[]> {
    return [...this.runs.values()]
      .filter((r) => r.workspaceId === workspaceId && r.ownerKind === ownerKind && r.ownerId === ownerId)
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
  }

  async listRecentRuns(workspaceId: string, limit: number): Promise<EvalRunRow[]> {
    return [...this.runs.values()]
      .filter((r) => r.workspaceId === workspaceId)
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
      .slice(0, limit);
  }

  async activeRunForOwner(workspaceId: string, ownerKind: string, ownerId: string): Promise<EvalRunRow | undefined> {
    return [...this.runs.values()].find(
      (r) =>
        r.workspaceId === workspaceId &&
        r.ownerKind === ownerKind &&
        r.ownerId === ownerId &&
        r.status === 'running',
    );
  }

  async completeRun(id: string, values: Record<string, unknown>): Promise<void> {
    const row = this.runs.get(id);
    if (!row) return;
    this.runs.set(id, { ...row, ...values, finishedAt: new Date() } as EvalRunRow);
  }

  async reconcileStaleRunning(
    cutoff: Date,
    scope?: { workspaceId: string; ownerKind: string; ownerId: string },
  ): Promise<number> {
    let n = 0;
    for (const [id, row] of this.runs) {
      if (row.status !== 'running' || row.ranAt.getTime() >= cutoff.getTime()) continue;
      if (scope && (row.workspaceId !== scope.workspaceId || row.ownerKind !== scope.ownerKind || row.ownerId !== scope.ownerId)) {
        continue;
      }
      this.runs.set(id, { ...row, status: 'errored', errorReason: 'interrupted', finishedAt: new Date() });
      n++;
    }
    return n;
  }

  async agentsWithCases(workspaceId: string): Promise<string[]> {
    return [...new Set([...this.cases.values()].filter((c) => c.workspaceId === workspaceId).map((c) => c.ownerId))];
  }

  // ---- specs/15-skill-eval-cases.md — skill-owned lookups ------------------
  skillRows = new Map<string, SkillForEval & { workspaceId: string }>();
  carriersByskill = new Map<string, CarrierForSkill[]>();
  skillVersionBodies = new Map<string, string>();
  injectedForFinding = new Map<string, InjectedSkillForFinding[]>();

  async skillForEval(workspaceId: string, skillId: string): Promise<SkillForEval | undefined> {
    const row = this.skillRows.get(skillId);
    if (!row || row.workspaceId !== workspaceId) return undefined;
    const { workspaceId: _ws, ...rest } = row;
    return rest;
  }

  async carriersForSkill(workspaceId: string, skillId: string): Promise<CarrierForSkill[]> {
    void workspaceId;
    // Mirrors the real repository's `ORDER BY agent_skills.order, agents.name`
    // (R5's deterministic tie-break) — sorted here rather than trusting test
    // setup to insert in the right order.
    return [...(this.carriersByskill.get(skillId) ?? [])].sort(
      (a, b) => a.order - b.order || a.agentName.localeCompare(b.agentName),
    );
  }

  async skillsInjectedForFinding(workspaceId: string, findingId: string): Promise<InjectedSkillForFinding[]> {
    void workspaceId;
    return this.injectedForFinding.get(findingId) ?? [];
  }

  async skillVersionBody(workspaceId: string, skillId: string, version: number): Promise<string | undefined> {
    const skill = await this.skillForEval(workspaceId, skillId);
    if (!skill) return undefined;
    if (skill.version === version) return skill.body;
    return this.skillVersionBodies.get(`${skillId}:${version}`);
  }

  async ownersWithCases(workspaceId: string, ownerKind: string): Promise<string[]> {
    return [
      ...new Set(
        [...this.cases.values()]
          .filter((c) => c.workspaceId === workspaceId && c.ownerKind === ownerKind)
          .map((c) => c.ownerId),
      ),
    ];
  }
}

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 'agent-1',
    name: 'Security Reviewer',
    provider: 'openai',
    model: 'gpt-4o-mini',
    systemPrompt: 'system',
    strategy: 'single-pass',
    version: 1,
    ...overrides,
  };
}

function makeSkill(overrides: Partial<SkillForEval> = {}): SkillForEval {
  return {
    id: 'skill-1',
    name: 'secret-leakage-gate',
    type: 'security',
    body: 'Flag secrets.',
    version: 1,
    enabled: true,
    ...overrides,
  };
}

function makeService(
  repo: FakeEvalRepository,
  opts: {
    getById?: (workspaceId: string, id: string) => Promise<AgentRecord | null | undefined>;
    listEnabled?: (workspaceId: string) => Promise<AgentRecord[]>;
    resolveLlm?: () => Promise<unknown>;
    runCase?: (agent: unknown, skillBlocks: unknown, llm: unknown, evalCase: unknown) => Promise<unknown>;
    linkedSkills?: (agentId: string) => Promise<LinkedSkillForRun[]>;
  } = {},
) {
  const agents = {
    getById: opts.getById ?? (async (_ws: string, id: string) => (id === 'agent-1' ? makeAgent() : undefined)),
    listEnabled: opts.listEnabled ?? (async () => [makeAgent()]),
  };
  const skills = { enabledSkills: async () => [] };
  const resolveLlm = opts.resolveLlm ?? (async () => ({ id: 'openai' }) as never);
  const executor = { runCase: opts.runCase ?? (async () => ({
    findings: [],
    groundingKept: 0,
    groundingTotal: 0,
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.001,
    durationMs: 1,
    assembly: {} as never,
  })) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const carrierSkills = { linkedSkills: opts.linkedSkills ?? (async () => []) };
  return new EvalService(
    repo as never,
    agents as never,
    skills as never,
    resolveLlm as never,
    () => 0.001,
    logger,
    executor as never,
    carrierSkills,
  );
}

describe('EvalService.createCaseFromFinding — AC-1 … AC-7', () => {
  const findingBase: FindingForCase = {
    finding: {
      id: 'finding-1',
      file: 'src/a.ts',
      startLine: 10,
      endLine: 10,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      acceptedAt: null,
      dismissedAt: null,
    },
    agentId: 'agent-1',
    prId: 'pr-1',
    prNumber: 42,
    prTitle: 'PR title',
    prBody: 'body',
  };
  const PATCH = '@@ -8,3 +8,4 @@\n context\n+  secret: "x",\n context';

  it('AC-2 — refuses a finding with neither accepted_at nor dismissed_at', async () => {
    const repo = new FakeEvalRepository();
    repo.findings.set('finding-1', findingBase);
    const service = makeService(repo);
    await expect(service.createCaseFromFinding('ws1', 'finding-1')).rejects.toThrow(/accept or dismiss/i);
  });

  it('AC-3 — accepted finding → must_find with the finding file/lines', async () => {
    const repo = new FakeEvalRepository();
    repo.findings.set('finding-1', {
      ...findingBase,
      finding: { ...findingBase.finding, acceptedAt: new Date() },
    });
    repo.filePatches.set('pr-1:src/a.ts', PATCH);
    const service = makeService(repo);
    const { case: evalCase, created } = await service.createCaseFromFinding('ws1', 'finding-1');
    expect(created).toBe(true);
    expect(evalCase.expectation.type).toBe('must_find');
    expect(evalCase.expectation.file).toBe('src/a.ts');
    expect(evalCase.expectation.start_line).toBe(10);
  });

  it('AC-4 — dismissed finding → must_not_flag', async () => {
    const repo = new FakeEvalRepository();
    repo.findings.set('finding-1', {
      ...findingBase,
      finding: { ...findingBase.finding, dismissedAt: new Date() },
    });
    repo.filePatches.set('pr-1:src/a.ts', PATCH);
    const service = makeService(repo);
    const { case: evalCase } = await service.createCaseFromFinding('ws1', 'finding-1');
    expect(evalCase.expectation.type).toBe('must_not_flag');
  });

  it('AC-1/D17 — activating twice returns the SAME case, not a second one', async () => {
    const repo = new FakeEvalRepository();
    repo.findings.set('finding-1', {
      ...findingBase,
      finding: { ...findingBase.finding, acceptedAt: new Date() },
    });
    repo.filePatches.set('pr-1:src/a.ts', PATCH);
    const service = makeService(repo);
    const first = await service.createCaseFromFinding('ws1', 'finding-1');
    const second = await service.createCaseFromFinding('ws1', 'finding-1');
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.case.id).toBe(first.case.id);
    expect(await repo.listCasesForOwner('ws1', 'agent', 'agent-1')).toHaveLength(1);
  });

  it('AC-6 — an expectation outside every hunk is refused and creates no case', async () => {
    const repo = new FakeEvalRepository();
    repo.findings.set('finding-1', {
      ...findingBase,
      finding: { ...findingBase.finding, acceptedAt: new Date(), startLine: 999, endLine: 999 },
    });
    repo.filePatches.set('pr-1:src/a.ts', PATCH);
    const service = makeService(repo);
    await expect(service.createCaseFromFinding('ws1', 'finding-1')).rejects.toThrow(AppError);
    expect(await repo.listCasesForOwner('ws1', 'agent', 'agent-1')).toHaveLength(0);
  });

  it('AC-6/Q4 — a null patch (PR #482 shape) is refused with a stated reason', async () => {
    const repo = new FakeEvalRepository();
    repo.findings.set('finding-1', {
      ...findingBase,
      finding: { ...findingBase.finding, acceptedAt: new Date() },
    });
    repo.filePatches.set('pr-1:src/a.ts', null);
    const service = makeService(repo);
    await expect(service.createCaseFromFinding('ws1', 'finding-1')).rejects.toThrow(/no diff text/i);
  });

  it('404s for a finding not found (or in another workspace)', async () => {
    const repo = new FakeEvalRepository();
    const service = makeService(repo);
    await expect(service.createCaseFromFinding('ws1', 'ghost')).rejects.toThrow(NotFoundError);
  });
});

describe('EvalService run lifecycle — AC-15, AC-49', () => {
  it('AC-49 — refuses to start with no cases, and creates no run record', async () => {
    const repo = new FakeEvalRepository();
    const service = makeService(repo);
    await expect(service.startRun('ws1', 'agent-1')).rejects.toThrow(/no eval cases/i);
    expect(await repo.listRunsForOwner('ws1', 'agent', 'agent-1')).toHaveLength(0);
  });

  it('AC-49/finding 9 — ConfigError from the LLM resolver surfaces as a 422, and creates no run record', async () => {
    const repo = new FakeEvalRepository();
    await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'c1',
      inputDiff: 'd',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });
    const service = makeService(repo, {
      resolveLlm: async () => {
        throw new ConfigError('OPENAI_API_KEY is not configured');
      },
    });
    let caught: unknown;
    try {
      await service.startRun('ws1', 'agent-1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).statusCode).toBe(422);
    expect(await repo.listRunsForOwner('ws1', 'agent', 'agent-1')).toHaveLength(0);
  });

  it('AC-15 — a second start while one is in flight is refused; exactly one run exists', async () => {
    const repo = new FakeEvalRepository();
    await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'c1',
      inputDiff: 'd',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });
    // A never-resolving executor keeps the background execution "in flight"
    // for the duration of this test (server/LEARNINGS.md's in-flight-guard
    // recipe: control timing explicitly rather than racing `Promise.all`).
    const service = makeService(repo, { runCase: () => new Promise(() => {}) });

    const first = await service.startRun('ws1', 'agent-1');
    await expect(service.startRun('ws1', 'agent-1')).rejects.toThrow(/already in progress/i);

    const runs = await repo.listRunsForOwner('ws1', 'agent', 'agent-1');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).toBe(first.run_id);
  });

  it('D19 — a stale running run is reconciled to errored before the guard, unblocking a new start', async () => {
    const repo = new FakeEvalRepository();
    await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'c1',
      inputDiff: 'd',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });
    const stale = await repo.insertRun({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      agentVersion: 1,
      caseIds: [],
    });
    // Backdate it past the staleness timeout.
    repo.runs.set(stale.id, { ...stale, ranAt: new Date(Date.now() - 20 * 60_000) });

    const service = makeService(repo, {
      runCase: async () => ({
        findings: [],
        groundingKept: 0,
        groundingTotal: 0,
        tokensIn: 1,
        tokensOut: 1,
        costUsd: 0.001,
        durationMs: 1,
        assembly: {} as never,
      }),
    });
    const result = await service.startRun('ws1', 'agent-1');
    expect(result.run_id).not.toBe(stale.id);
    const staleRow = await repo.getRun('ws1', stale.id);
    expect(staleRow!.status).toBe('errored');
    expect(staleRow!.errorReason).toBe('interrupted');
  });

  it('AC-11 — a per-case throw completes the run, marks that case errored, and records cases_errored', async () => {
    const repo = new FakeEvalRepository();
    const c1 = await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'good',
      inputDiff: 'd',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });
    await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'boom',
      inputDiff: 'd',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });

    let call = 0;
    const service = makeService(repo, {
      runCase: async () => {
        call++;
        if (call === 2) throw new Error('provider timeout');
        return {
          findings: [{ file: 'f', start_line: 1, end_line: 1, severity: 'WARNING', category: 'bug', title: 't' }],
          groundingKept: 1,
          groundingTotal: 1,
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0.001,
          durationMs: 1,
          assembly: {} as never,
        };
      },
    });

    const started = await service.startRun('ws1', 'agent-1');
    // Background execution is fire-and-forget; wait a tick for it to settle.
    await new Promise((r) => setTimeout(r, 20));

    const row = await repo.getRun('ws1', started.run_id);
    expect(row!.status).toBe('completed');
    expect(row!.casesErrored).toBe(1);
    const errored = row!.perCase.find((o) => o.status === 'errored');
    expect(errored?.error_reason).toBe('provider timeout');
    void c1;
  });
});

describe('EvalService — AC-23 full run persistence', () => {
  it('a completed run stores metrics, per-case outcomes, agent version, case ids, duration, errored count and cost', async () => {
    const repo = new FakeEvalRepository();
    const c1 = await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'must-find-case',
      inputDiff: 'd1',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });
    const c2 = await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'must-not-flag-case',
      inputDiff: 'd2',
      inputFiles: ['g'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_not_flag', file: 'g', start_line: 5, end_line: 5 },
    });

    let call = 0;
    const service = makeService(repo, {
      getById: async (_ws: string, id: string) => (id === 'agent-1' ? makeAgent({ version: 7 }) : undefined),
      runCase: async () => {
        call++;
        if (call === 1) {
          return {
            findings: [{ file: 'f', start_line: 1, end_line: 1, severity: 'CRITICAL', category: 'security', title: 't' }],
            groundingKept: 1,
            groundingTotal: 1,
            tokensIn: 10,
            tokensOut: 5,
            costUsd: 0.002,
            durationMs: 20,
            assembly: {} as never,
          };
        }
        return {
          findings: [],
          groundingKept: 0,
          groundingTotal: 0,
          tokensIn: 5,
          tokensOut: 2,
          costUsd: 0.001,
          durationMs: 15,
          assembly: {} as never,
        };
      },
    });

    const started = await service.startRun('ws1', 'agent-1');
    await new Promise((r) => setTimeout(r, 20));

    const row = await repo.getRun('ws1', started.run_id);
    expect(row!.status).toBe('completed');
    expect(row!.agentVersion).toBe(7);
    expect(row!.caseIds.slice().sort()).toEqual([c1.id, c2.id].sort());
    expect(row!.casesErrored).toBe(0);
    expect(row!.tracesPassed).toBe(2);
    expect(row!.tracesTotal).toBe(2);
    expect(row!.recall).toBe(1);
    expect(row!.precision).toBe(1);
    expect(row!.citationAccuracy).toBe(1);
    expect(row!.durationMs).toBeGreaterThanOrEqual(0);
    expect(row!.costUsd).toBeCloseTo(0.003, 5);
    expect(row!.perCase).toHaveLength(2);
    expect(row!.perCase.map((o) => o.case_id).sort()).toEqual([c1.id, c2.id].sort());
    expect(row!.finishedAt).not.toBeNull();
  });
});

describe('EvalService.compare — AC-32 … AC-34, D20', () => {
  function completedOutcome(overrides: Partial<{
    case_id: string;
    name: string;
    expectation_type: 'must_find' | 'must_not_flag';
    pass: boolean;
    findings_total: number;
    findings_matched: number;
    grounding_kept: number;
    grounding_total: number;
  }>) {
    return {
      case_id: 'case',
      name: 'case',
      expectation_type: 'must_find' as const,
      status: 'scored' as const,
      pass: true,
      error_reason: null,
      findings_total: 0,
      findings_matched: 0,
      grounding_kept: 0,
      grounding_total: 0,
      duration_ms: 1,
      cost_usd: 0,
      actual: [],
      ...overrides,
    };
  }

  it('AC-32 — rejects comparing a run against itself, runs of different agents, or a missing run', async () => {
    const repo = new FakeEvalRepository();
    const runA = await repo.insertRun({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      agentVersion: 1,
      caseIds: [],
    });
    await repo.completeRun(runA.id, {
      status: 'completed',
      perCase: [],
      casesErrored: 0,
      tracesPassed: 0,
      tracesTotal: 0,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: 1,
      costUsd: 0,
    });
    const runOtherAgent = await repo.insertRun({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-2',
      agentVersion: 1,
      caseIds: [],
    });
    await repo.completeRun(runOtherAgent.id, {
      status: 'completed',
      perCase: [],
      casesErrored: 0,
      tracesPassed: 0,
      tracesTotal: 0,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: 1,
      costUsd: 0,
    });

    const service = makeService(repo);
    await expect(service.compare('ws1', runA.id, runA.id)).rejects.toThrow(/distinct/i);
    await expect(service.compare('ws1', runA.id, runOtherAgent.id)).rejects.toThrow(/same agent/i);
    await expect(service.compare('ws1', runA.id, 'ghost-run')).rejects.toThrow(NotFoundError);
  });

  it('AC-33/D20 — states the case-set difference and computes deltas over the intersection, even when the older run has an errored case', async () => {
    const repo = new FakeEvalRepository();
    const c1 = await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'c1',
      inputDiff: 'd',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });
    const c2 = await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'c2',
      inputDiff: 'd',
      inputFiles: ['g'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_not_flag', file: 'g', start_line: 5, end_line: 5 },
    });

    // Older run: taken BEFORE c3 existed. D20 — one case (c1) is errored;
    // the run as a whole is still `completed` and must stay compare-eligible.
    const older = await repo.insertRun({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      agentVersion: 1,
      caseIds: [c1.id, c2.id],
    });
    await repo.completeRun(older.id, {
      status: 'completed',
      perCase: [
        {
          ...completedOutcome({
            case_id: c1.id,
            name: 'c1',
            expectation_type: 'must_find',
            pass: null as unknown as boolean,
            findings_total: 0,
          }),
          status: 'errored',
          error_reason: 'provider timeout',
        },
        completedOutcome({
          case_id: c2.id,
          name: 'c2',
          expectation_type: 'must_not_flag',
          pass: true,
          findings_total: 1,
          findings_matched: 0,
          grounding_kept: 1,
          grounding_total: 1,
        }),
      ],
      casesErrored: 1,
      tracesPassed: 1,
      tracesTotal: 2,
      recall: null,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 10,
      costUsd: 0.01,
    });
    repo.runs.set(older.id, { ...repo.runs.get(older.id)!, ranAt: new Date('2026-01-01T00:00:00Z') });

    // A case created AFTER the older run.
    const c3 = await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'c3',
      inputDiff: 'd',
      inputFiles: ['h'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'h', start_line: 1, end_line: 1 },
    });

    const newer = await repo.insertRun({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      agentVersion: 2,
      caseIds: [c1.id, c2.id, c3.id],
    });
    await repo.completeRun(newer.id, {
      status: 'completed',
      perCase: [
        completedOutcome({
          case_id: c1.id,
          name: 'c1',
          expectation_type: 'must_find',
          pass: false,
          findings_total: 1,
          findings_matched: 0,
          grounding_kept: 1,
          grounding_total: 1,
        }),
        completedOutcome({
          case_id: c2.id,
          name: 'c2',
          expectation_type: 'must_not_flag',
          pass: true,
          findings_total: 2,
          findings_matched: 0,
          grounding_kept: 2,
          grounding_total: 2,
        }),
        completedOutcome({
          case_id: c3.id,
          name: 'c3',
          expectation_type: 'must_find',
          pass: true,
          findings_total: 1,
          findings_matched: 1,
          grounding_kept: 1,
          grounding_total: 1,
        }),
      ],
      casesErrored: 0,
      tracesPassed: 2,
      tracesTotal: 3,
      recall: 0.5,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 12,
      costUsd: 0.02,
    });
    repo.runs.set(newer.id, { ...repo.runs.get(newer.id)!, ranAt: new Date('2026-01-02T00:00:00Z') });

    repo.agentVersionPrompts.set('agent-1:1', 'You are a reviewer.\nBe lenient.');
    repo.agentVersionPrompts.set('agent-1:2', 'You are a reviewer.\nBe strict.');

    const service = makeService(repo);
    // Argument order must not matter — compare sorts by ranAt internally.
    const result = await service.compare('ws1', newer.id, older.id);

    expect(result.old.id).toBe(older.id);
    expect(result.new.id).toBe(newer.id);
    // D20 — the errored-case run participated fully; its metrics are still exposed.
    expect(result.old.metrics?.cases_errored).toBe(1);

    expect(result.common_case_ids.slice().sort()).toEqual([c1.id, c2.id].sort());
    expect(result.only_in_old).toEqual([]);
    expect(result.only_in_new).toEqual([c3.id]);

    // Deltas recomputed over the COMMON set only (c1, c2) — c3 must not leak
    // in. older/common: c1's outcome is `errored` (AC-11 — excluded from
    // every numerator/denominator), leaving zero SCORED must_find cases in
    // the older side, so recall is `null` (AC-20's "not applicable"), not 0
    // or 1. newer/common: c1 is scored (not errored) and fails → recall 0/1.
    // nullableDelta(null, 0) is `null` — one side being not-applicable makes
    // the delta itself not-applicable, never a fabricated number.
    expect(result.deltas.recall).toBeNull();
    expect(result.deltas.precision).toBe(0);
    expect(result.deltas.citation_accuracy).toBe(0);

    expect(result.prompt_diff).toContainEqual({ kind: 'context', text: 'You are a reviewer.' });
    expect(result.prompt_diff).toContainEqual({ kind: 'removed', text: 'Be lenient.' });
    expect(result.prompt_diff).toContainEqual({ kind: 'added', text: 'Be strict.' });
  });
});

describe('EvalService.updateCase / deleteCase — AC-12 … AC-14', () => {
  it('AC-14 — editing a case leaves a stored run byte-identical', async () => {
    const repo = new FakeEvalRepository();
    const c1 = await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      name: 'original',
      inputDiff: '@@ -1,1 +1,1 @@\n-x\n+y',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });
    const run = await repo.insertRun({
      workspaceId: 'ws1',
      ownerKind: 'agent',
      ownerId: 'agent-1',
      agentVersion: 1,
      caseIds: [c1.id],
    });
    await repo.completeRun(run.id, {
      status: 'completed',
      perCase: [
        {
          case_id: c1.id,
          name: 'original',
          expectation_type: 'must_find',
          status: 'scored',
          pass: true,
          error_reason: null,
          findings_total: 1,
          findings_matched: 1,
          grounding_kept: 1,
          grounding_total: 1,
          duration_ms: 5,
          cost_usd: 0.001,
          actual: [],
        },
      ],
      casesErrored: 0,
      tracesPassed: 1,
      tracesTotal: 1,
      recall: 1,
      precision: 1,
      citationAccuracy: 1,
      durationMs: 5,
      costUsd: 0.001,
    });
    const before = JSON.stringify(await repo.getRun('ws1', run.id));

    const service = makeService(repo);
    await service.updateCase('ws1', c1.id, { name: 'renamed' });
    await service.deleteCase('ws1', c1.id);

    const after = JSON.stringify(await repo.getRun('ws1', run.id));
    expect(after).toBe(before);
  });
});

// =============================================================================
// specs/15-skill-eval-cases.md — skill-owned service surface. Same fake-
// repo/port style as the agent-owned suites above; `plans/15-skill-eval-
// cases.md` didn't mandate these AS explicitly as scoring.ts/executor.ts, but
// the plan-verifier gate flagged the ~10 new skill-owned methods as
// unit-untested, and several have edge cases the DB-backed `eval.it.test.ts`
// happy-path coverage doesn't reach (refusals, idempotency, in-flight guard,
// gate-bypass estimate, per-arm error isolation).
// =============================================================================

function makeCarrier(overrides: Partial<CarrierForSkill> = {}): CarrierForSkill {
  return {
    agentId: 'agent-1',
    agentName: 'Security Reviewer',
    provider: 'openai',
    model: 'gpt-4o-mini',
    systemPrompt: 'system',
    strategy: 'single-pass',
    agentVersion: 1,
    order: 1,
    linkEnabled: true,
    skillEnabled: true,
    ...overrides,
  };
}

describe('EvalService.listSkillOffersForFinding / createCaseFromFindingForSkill — AC-1, AC-2', () => {
  const findingBase: FindingForCase = {
    finding: {
      id: 'finding-1',
      file: 'src/config.ts',
      startLine: 12,
      endLine: 12,
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded secret',
      acceptedAt: null,
      dismissedAt: null,
    },
    agentId: 'agent-1',
    prId: 'pr-1',
    prNumber: 42,
    prTitle: 'PR title',
    prBody: 'body',
  };
  const PATCH = '@@ -10,3 +10,4 @@\n context\n+  key: "sk_live_x",\n context';

  it('AC-2 — the offer list is scoped to skills the finding’s OWN review actually injected, with has_case stated', async () => {
    const repo = new FakeEvalRepository();
    repo.findings.set('finding-1', {
      ...findingBase,
      finding: { ...findingBase.finding, acceptedAt: new Date() },
    });
    repo.injectedForFinding.set('finding-1', [{ skillId: 'skill-1', skillName: 'secret-leakage-gate' }]);
    const service = makeService(repo);

    const offers = await service.listSkillOffersForFinding('ws1', 'finding-1');
    expect(offers).toEqual([{ skill_id: 'skill-1', skill_name: 'secret-leakage-gate', has_case: false }]);
  });

  it('AC-1 — refuses a skill that was NOT injected into the finding’s own review, even if the skill exists', async () => {
    const repo = new FakeEvalRepository();
    repo.findings.set('finding-1', {
      ...findingBase,
      finding: { ...findingBase.finding, acceptedAt: new Date() },
    });
    repo.injectedForFinding.set('finding-1', []); // this review injected nothing
    const service = makeService(repo);

    await expect(service.createCaseFromFindingForSkill('ws1', 'finding-1', 'skill-1')).rejects.toThrow(
      /not present in the prompt/i,
    );
    expect(await repo.listCasesForOwner('ws1', 'skill', 'skill-1')).toHaveLength(0);
  });

  it('AC-1/D17 — activating twice for the SAME skill returns the SAME case, and the offer list then states has_case: true', async () => {
    const repo = new FakeEvalRepository();
    repo.findings.set('finding-1', {
      ...findingBase,
      finding: { ...findingBase.finding, acceptedAt: new Date() },
    });
    repo.injectedForFinding.set('finding-1', [{ skillId: 'skill-1', skillName: 'secret-leakage-gate' }]);
    repo.filePatches.set('pr-1:src/config.ts', PATCH);
    const service = makeService(repo);

    const first = await service.createCaseFromFindingForSkill('ws1', 'finding-1', 'skill-1');
    const second = await service.createCaseFromFindingForSkill('ws1', 'finding-1', 'skill-1');
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.case.id).toBe(first.case.id);
    expect(first.case.owner_kind).toBe('skill');
    expect(first.case.owner_id).toBe('skill-1');
    expect(await repo.listCasesForOwner('ws1', 'skill', 'skill-1')).toHaveLength(1);

    const offers = await service.listSkillOffersForFinding('ws1', 'finding-1');
    expect(offers[0]).toMatchObject({ skill_id: 'skill-1', has_case: true });
  });
});

describe('EvalService.createSkillCase — AC-8, AC-9', () => {
  const input = {
    name: 'hand-authored',
    input_diff:
      'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,2 +1,3 @@\n context\n+  key: "sk_live_x",\n context',
    input_files: ['src/config.ts'],
    input_meta: { pr_number: null, title: 't', body: null },
    // Line 2 of the new file is the added `+` line above (AC-9's grounding
    // check needs a real hunk match, not just a plausible-looking line pair).
    expectation: { type: 'must_find' as const, file: 'src/config.ts', start_line: 2, end_line: 2 },
  };

  it('creates a hand-authored case owned by the skill, with no source finding', async () => {
    const repo = new FakeEvalRepository();
    repo.skillRows.set('skill-1', { ...makeSkill(), workspaceId: 'ws1' });
    const service = makeService(repo);
    const evalCase = await service.createSkillCase('ws1', 'skill-1', input);
    expect(evalCase.owner_kind).toBe('skill');
    expect(evalCase.owner_id).toBe('skill-1');
    expect(evalCase.source_finding_id).toBeNull();
  });

  it('AC-9 — refuses an expectation outside every hunk of the supplied diff, and creates no case', async () => {
    const repo = new FakeEvalRepository();
    repo.skillRows.set('skill-1', { ...makeSkill(), workspaceId: 'ws1' });
    const service = makeService(repo);
    await expect(
      service.createSkillCase('ws1', 'skill-1', {
        ...input,
        expectation: { ...input.expectation, start_line: 999, end_line: 999 },
      }),
    ).rejects.toThrow(AppError);
    expect(await repo.listCasesForOwner('ws1', 'skill', 'skill-1')).toHaveLength(0);
  });

  it('404s for an unknown or cross-workspace skill', async () => {
    const repo = new FakeEvalRepository();
    const service = makeService(repo);
    await expect(service.createSkillCase('ws1', 'ghost-skill', input)).rejects.toThrow(NotFoundError);
  });
});

describe('EvalService.createAgentCase — the agent-owned mirror of createSkillCase (AC-8, AC-9)', () => {
  const input = {
    name: 'hand-authored',
    input_diff:
      'diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,2 +1,3 @@\n context\n+  key: "sk_live_x",\n context',
    input_files: ['src/config.ts'],
    input_meta: { pr_number: null, title: 't', body: null },
    expectation: { type: 'must_find' as const, file: 'src/config.ts', start_line: 2, end_line: 2 },
  };

  it('creates a hand-authored case owned by the agent, with no source finding', async () => {
    const repo = new FakeEvalRepository();
    const service = makeService(repo); // default getById resolves 'agent-1'
    const evalCase = await service.createAgentCase('ws1', 'agent-1', input);
    expect(evalCase.owner_kind).toBe('agent');
    expect(evalCase.owner_id).toBe('agent-1');
    expect(evalCase.source_finding_id).toBeNull();
  });

  it('AC-9 — refuses an expectation outside every hunk of the supplied diff, and creates no case', async () => {
    const repo = new FakeEvalRepository();
    const service = makeService(repo);
    await expect(
      service.createAgentCase('ws1', 'agent-1', {
        ...input,
        expectation: { ...input.expectation, start_line: 999, end_line: 999 },
      }),
    ).rejects.toThrow(AppError);
    expect(await repo.listCasesForOwner('ws1', 'agent', 'agent-1')).toHaveLength(0);
  });

  it('404s for an unknown or cross-workspace agent', async () => {
    const repo = new FakeEvalRepository();
    const service = makeService(repo);
    await expect(service.createAgentCase('ws1', 'ghost-agent', input)).rejects.toThrow(NotFoundError);
  });
});

describe('EvalService.startSkillRun — AC-11, AC-14, AC-15, AC-49, AC-52, D8, D19, AC-53', () => {
  function seedSkillWithCase(repo: FakeEvalRepository, skillOverrides: Partial<SkillForEval> = {}) {
    repo.skillRows.set('skill-1', { ...makeSkill(skillOverrides), workspaceId: 'ws1' });
    return repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'skill',
      ownerId: 'skill-1',
      name: 'c1',
      inputDiff: 'd',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });
  }

  it('404s for an unknown skill — before touching the carrier or any case row', async () => {
    const repo = new FakeEvalRepository();
    const service = makeService(repo);
    await expect(service.startSkillRun('ws1', 'ghost-skill', 'agent-1')).rejects.toThrow(NotFoundError);
  });

  it('AC-53 — 404s for a carrier the workspace-scoped port cannot resolve, even when the skill already has cases', async () => {
    const repo = new FakeEvalRepository();
    await seedSkillWithCase(repo);
    const service = makeService(repo, { getById: async () => undefined });
    await expect(service.startSkillRun('ws1', 'skill-1', 'foreign-agent')).rejects.toThrow(NotFoundError);
  });

  it('AC-49 — no_agent_linked when the resolved carrier is not linked to this skill', async () => {
    const repo = new FakeEvalRepository();
    await seedSkillWithCase(repo);
    repo.carriersByskill.set('skill-1', []); // no link at all
    const service = makeService(repo);
    await expect(service.startSkillRun('ws1', 'skill-1', 'agent-1')).rejects.toThrow(/not linked/i);
  });

  it('AC-49 — refuses to start with no cases, and creates no run record', async () => {
    const repo = new FakeEvalRepository();
    repo.skillRows.set('skill-1', { ...makeSkill(), workspaceId: 'ws1' });
    repo.carriersByskill.set('skill-1', [makeCarrier()]);
    const service = makeService(repo);
    await expect(service.startSkillRun('ws1', 'skill-1', 'agent-1')).rejects.toThrow(/no eval cases/i);
    expect(await repo.listRunsForOwner('ws1', 'skill', 'skill-1')).toHaveLength(0);
  });

  it('AC-49/finding 9 — ConfigError from the LLM resolver surfaces as a 422, and creates no run record', async () => {
    const repo = new FakeEvalRepository();
    await seedSkillWithCase(repo);
    repo.carriersByskill.set('skill-1', [makeCarrier()]);
    const service = makeService(repo, {
      resolveLlm: async () => {
        throw new ConfigError('OPENAI_API_KEY is not configured');
      },
    });
    let caught: unknown;
    try {
      await service.startSkillRun('ws1', 'skill-1', 'agent-1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).statusCode).toBe(422);
    expect(await repo.listRunsForOwner('ws1', 'skill', 'skill-1')).toHaveLength(0);
  });

  it('AC-15 — a second start while one is in flight is refused; exactly one run exists', async () => {
    const repo = new FakeEvalRepository();
    await seedSkillWithCase(repo);
    repo.carriersByskill.set('skill-1', [makeCarrier()]);
    const service = makeService(repo, { runCase: () => new Promise(() => {}) });

    const first = await service.startSkillRun('ws1', 'skill-1', 'agent-1');
    await expect(service.startSkillRun('ws1', 'skill-1', 'agent-1')).rejects.toThrow(/already in progress/i);

    const runs = await repo.listRunsForOwner('ws1', 'skill', 'skill-1');
    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).toBe(first.run_id);
  });

  it('D19 — a stale running skill run is reconciled to errored before the guard, unblocking a new start', async () => {
    const repo = new FakeEvalRepository();
    await seedSkillWithCase(repo);
    repo.carriersByskill.set('skill-1', [makeCarrier()]);
    const stale = await repo.insertRun({
      workspaceId: 'ws1',
      ownerKind: 'skill',
      ownerId: 'skill-1',
      agentVersion: 1,
      caseIds: [],
    });
    repo.runs.set(stale.id, { ...stale, ranAt: new Date(Date.now() - 20 * 60_000) });

    const service = makeService(repo);
    const result = await service.startSkillRun('ws1', 'skill-1', 'agent-1');
    expect(result.run_id).not.toBe(stale.id);
    const staleRow = await repo.getRun('ws1', stale.id);
    expect(staleRow!.status).toBe('errored');
  });

  it('AC-52/D8 — gates_bypassed is true when EITHER gate is off (here: the workspace/vetting gate)', async () => {
    const repo = new FakeEvalRepository();
    await seedSkillWithCase(repo, { enabled: false });
    repo.carriersByskill.set('skill-1', [makeCarrier({ linkEnabled: true })]);
    const service = makeService(repo);
    const result = await service.startSkillRun('ws1', 'skill-1', 'agent-1');
    expect(result.estimate.gates_bypassed).toBe(true);
  });

  it('AC-52/D8 — gates_bypassed is false when BOTH gates are on', async () => {
    const repo = new FakeEvalRepository();
    await seedSkillWithCase(repo, { enabled: true });
    repo.carriersByskill.set('skill-1', [makeCarrier({ linkEnabled: true })]);
    const service = makeService(repo);
    const result = await service.startSkillRun('ws1', 'skill-1', 'agent-1');
    expect(result.estimate.gates_bypassed).toBe(false);
  });
});

describe('EvalService.executeSkillRun (via startSkillRun, background) — AC-16, AC-23, AC-24', () => {
  it('stores both arms with lift derivable from them on a clean completed run', async () => {
    const repo = new FakeEvalRepository();
    repo.skillRows.set('skill-1', { ...makeSkill(), workspaceId: 'ws1' });
    repo.carriersByskill.set('skill-1', [makeCarrier()]);
    await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'skill',
      ownerId: 'skill-1',
      name: 'c1',
      inputDiff: 'd',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });

    const service = makeService(repo, {
      // The skill-under-test's block only appears in the WITH arm (AC-16) —
      // use that to make the with-arm "find" the case and the without-arm
      // "miss" it, so the run has a real, non-degenerate lift to assert on.
      runCase: async (_agent, skillBlocks) => {
        const isWithArm = (skillBlocks as { name: string }[]).some((s) => s.name === 'secret-leakage-gate');
        return {
          findings: isWithArm
            ? [{ file: 'f', start_line: 1, end_line: 1, severity: 'CRITICAL', category: 'security', title: 't' }]
            : [],
          groundingKept: isWithArm ? 1 : 0,
          groundingTotal: isWithArm ? 1 : 0,
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0.001,
          durationMs: 1,
          assembly: {} as never,
        };
      },
    });

    const started = await service.startSkillRun('ws1', 'skill-1', 'agent-1');
    await new Promise((r) => setTimeout(r, 20));

    const row = await repo.getRun('ws1', started.run_id);
    expect(row!.status).toBe('completed');
    // The with-arm (stored in the base columns) found the case; recall = 1.
    expect(row!.recall).toBe(1);
    // The without-arm (stored separately) never found it; recall = 0 — the
    // skill's own block is what made the difference (D8's whole point).
    expect(row!.armWithout).not.toBeNull();
    expect(row!.armWithout!.recall).toBe(0);
  });

  it('AC-23 — a case erroring in only the WITHOUT arm is rewritten to errored in BOTH stored arms, and counted once', async () => {
    const repo = new FakeEvalRepository();
    repo.skillRows.set('skill-1', { ...makeSkill(), workspaceId: 'ws1' });
    repo.carriersByskill.set('skill-1', [makeCarrier()]);
    await repo.insertCase({
      workspaceId: 'ws1',
      ownerKind: 'skill',
      ownerId: 'skill-1',
      name: 'flaky',
      inputDiff: 'd',
      inputFiles: ['f'],
      inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });

    const service = makeService(repo, {
      runCase: async (_agent, skillBlocks) => {
        const isWithArm = (skillBlocks as { name: string }[]).some((s) => s.name === 'secret-leakage-gate');
        if (!isWithArm) throw new Error('provider timeout');
        return {
          findings: [],
          groundingKept: 0,
          groundingTotal: 0,
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0.001,
          durationMs: 1,
          assembly: {} as never,
        };
      },
    });

    const started = await service.startSkillRun('ws1', 'skill-1', 'agent-1');
    await new Promise((r) => setTimeout(r, 20));

    const row = await repo.getRun('ws1', started.run_id);
    expect(row!.status).toBe('completed');
    expect(row!.casesErrored).toBe(1);
    const errored = row!.perCase.find((o) => o.status === 'errored');
    expect(errored?.error_reason).toBe('paired arm failed');
    // The without-arm's OWN stored `cases_errored` reflects the same
    // exclusion — never zero, never double-counted.
    expect(row!.armWithout!.cases_errored).toBe(1);
  });
});

describe('EvalService.skillCompare — AC-32, AC-33', () => {
  async function completedSkillRun(
    repo: FakeEvalRepository,
    overrides: { carrierAgentId?: string | null; ranAt?: Date } = {},
  ) {
    const run = await repo.insertRun({
      workspaceId: 'ws1',
      ownerKind: 'skill',
      ownerId: 'skill-1',
      agentVersion: 1,
      caseIds: ['case-1'],
      skillVersion: 1,
      carrierAgentId: overrides.carrierAgentId ?? 'agent-1',
    });
    if (overrides.ranAt) repo.runs.set(run.id, { ...repo.runs.get(run.id)!, ranAt: overrides.ranAt });
    await repo.completeRun(run.id, {
      status: 'completed',
      perCase: [],
      casesErrored: 0,
      tracesPassed: 0,
      tracesTotal: 0,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs: 5,
      costUsd: 0.001,
      armWithout: { recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, cases_errored: 0, duration_ms: 5, cost_usd: 0.001, per_case: [] },
    });
    return repo.getRun('ws1', run.id) as Promise<EvalRunRow>;
  }

  it('rejects comparing two runs of DIFFERENT skills', async () => {
    const repo = new FakeEvalRepository();
    const a = await completedSkillRun(repo);
    const run2 = await repo.insertRun({
      workspaceId: 'ws1',
      ownerKind: 'skill',
      ownerId: 'skill-2',
      agentVersion: 1,
      caseIds: [],
      skillVersion: 1,
      carrierAgentId: 'agent-1',
    });
    await repo.completeRun(run2.id, {
      status: 'completed', perCase: [], casesErrored: 0, tracesPassed: 0, tracesTotal: 0,
      recall: null, precision: null, citationAccuracy: null, durationMs: 1, costUsd: 0,
    });

    const service = makeService(repo);
    await expect(service.skillCompare('ws1', a.id, run2.id)).rejects.toThrow(/same skill/i);
  });

  it('rejects comparing a NON-skill-owned (agent) run through the skill-compare route', async () => {
    const repo = new FakeEvalRepository();
    const a = await completedSkillRun(repo);
    const agentRun = await repo.insertRun({
      workspaceId: 'ws1', ownerKind: 'agent', ownerId: 'agent-1', agentVersion: 1, caseIds: [],
    });
    await repo.completeRun(agentRun.id, {
      status: 'completed', perCase: [], casesErrored: 0, tracesPassed: 0, tracesTotal: 0,
      recall: null, precision: null, citationAccuracy: null, durationMs: 1, costUsd: 0,
    });

    const service = makeService(repo);
    await expect(service.skillCompare('ws1', a.id, agentRun.id)).rejects.toThrow(/skill-owned/i);
  });

  it('states carrier_differs when the two skill runs used different carriers', async () => {
    const repo = new FakeEvalRepository();
    const older = await completedSkillRun(repo, { carrierAgentId: 'agent-1', ranAt: new Date('2026-01-01') });
    const newer = await completedSkillRun(repo, { carrierAgentId: 'agent-2', ranAt: new Date('2026-01-02') });

    const service = makeService(repo, {
      getById: async (_ws, id) => (id === 'agent-1' || id === 'agent-2' ? makeAgent({ id, name: id }) : undefined),
    });
    const result = await service.skillCompare('ws1', older.id, newer.id);
    expect(result.carrier_differs).toBe(true);
    expect(result.old.id).toBe(older.id);
    expect(result.new.id).toBe(newer.id);
  });
});

describe('EvalService.runAllSkills — R5, AC-26', () => {
  it('skips a skill with zero linked agents, stating the reason, and starts none for it', async () => {
    const repo = new FakeEvalRepository();
    repo.skillRows.set('skill-1', { ...makeSkill(), workspaceId: 'ws1' });
    repo.carriersByskill.set('skill-1', []);
    await repo.insertCase({
      workspaceId: 'ws1', ownerKind: 'skill', ownerId: 'skill-1', name: 'c1',
      inputDiff: 'd', inputFiles: ['f'], inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });

    const service = makeService(repo);
    const result = await service.runAllSkills('ws1');
    expect(result.started).toHaveLength(1);
    expect(result.started[0]).toMatchObject({
      skill_id: 'skill-1',
      run_id: null,
      refused_reason: expect.stringMatching(/no agent is linked/i),
    });
  });

  it('auto-selects the linked agent with the LOWEST order as carrier (R5), and starts a real run', async () => {
    const repo = new FakeEvalRepository();
    repo.skillRows.set('skill-1', { ...makeSkill(), workspaceId: 'ws1' });
    repo.carriersByskill.set('skill-1', [
      makeCarrier({ agentId: 'agent-2', agentName: 'Later Carrier', order: 2 }),
      makeCarrier({ agentId: 'agent-1', agentName: 'Security Reviewer', order: 0 }),
    ]);
    await repo.insertCase({
      workspaceId: 'ws1', ownerKind: 'skill', ownerId: 'skill-1', name: 'c1',
      inputDiff: 'd', inputFiles: ['f'], inputMeta: { pr_number: 1, title: 't', body: null },
      expectation: { type: 'must_find', file: 'f', start_line: 1, end_line: 1 },
    });

    const service = makeService(repo, {
      getById: async (_ws, id) => (id === 'agent-1' || id === 'agent-2' ? makeAgent({ id }) : undefined),
    });
    const result = await service.runAllSkills('ws1');
    const entry = result.started.find((s) => s.skill_id === 'skill-1');
    expect(entry?.carrier_agent_id).toBe('agent-1');
    expect(entry?.run_id).not.toBeNull();
  });
});
