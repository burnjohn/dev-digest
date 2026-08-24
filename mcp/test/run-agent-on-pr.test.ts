import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ActiveRun, ApiPort, ReviewProjection, RunStatus } from '../src/ports.js';
import { RepoCache } from '../src/resolve/cache.js';
import { decideRunAction, findActiveRun } from '../src/run/idempotency.js';
import { waitForRun, type RunWaiterDeps } from '../src/run/waiter.js';
import { registerRunAgentOnPr, type RunAgentOnPrDeps } from '../src/tools/run-agent-on-pr.js';

/**
 * T10's own test file — `run/idempotency.ts`, `run/waiter.ts` and the
 * `run_agent_on_pr` handler that sequences them. Every test supplies a fake
 * `ApiPort` object literal (REQ-32, `server/INSIGHTS.md` 2026-08-15) — no
 * `fetch` stub, no cast — and every timing test uses `vi.useFakeTimers()`
 * with an injected `sleep`/`now` (`server/INSIGHTS.md` 2026-08-21: no test
 * here reaches a live API or a live model, and none waits on a real timer).
 */

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function createFakeApi(overrides: Partial<ApiPort> = {}): ApiPort {
  return {
    lookupPull: vi.fn(async () => {
      throw new Error('lookupPull not stubbed for this test');
    }),
    listAgents: vi.fn(async () => {
      throw new Error('listAgents not stubbed for this test');
    }),
    listRepos: vi.fn(async () => {
      throw new Error('listRepos not stubbed for this test');
    }),
    listActiveRuns: vi.fn(async () => {
      throw new Error('listActiveRuns not stubbed for this test');
    }),
    startReview: vi.fn(async () => {
      throw new Error('startReview not stubbed for this test — must not be called');
    }),
    listRuns: vi.fn(async () => {
      throw new Error('listRuns not stubbed for this test');
    }),
    listReviews: vi.fn(async () => {
      throw new Error('listReviews not stubbed for this test');
    }),
    listConventions: vi.fn(async () => {
      throw new Error('listConventions not stubbed for this test');
    }),
    ...overrides,
  };
}

function fakePull(patch: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    pull: {
      repo_id: 'repo-1',
      pull_id: 'pull-1',
      number: 42,
      full_name: 'owner/name',
      head_sha: 'abc123',
      title: 'Add a feature',
      status: 'open' as const,
      ...patch,
    },
  };
}

/** Real `setTimeout`, virtualized entirely by `vi.useFakeTimers()` — never a
 *  real wall-clock wait (REQ-13's own "no real timer" proof). */
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enabledAgent() {
  return [{ id: 'agent-1', name: 'Security', model: 'gpt-5', enabled: true }];
}

function reviewFixture(patch: Partial<ReviewProjection> = {}): ReviewProjection {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security',
    created_at: '2026-08-23T10:00:00.000Z',
    verdict: 'approve',
    score: 95,
    findings: [],
    ...patch,
  };
}

// ---- run/idempotency.ts — REQ-15's table test -----------------------------

describe('decideRunAction (REQ-15, D-H\'s two-branch decision)', () => {
  function running(agentId: string, runId = 'run-x'): ActiveRun {
    return { run_id: runId, agent_id: agentId, agent_name: null, ran_at: null };
  }

  it('attaches when a run for THIS agent is already running', () => {
    expect(decideRunAction([running('agent-1')], 'agent-1')).toBe('attach');
  });

  it('starts when the only active run belongs to a DIFFERENT agent', () => {
    expect(decideRunAction([running('agent-2')], 'agent-1')).toBe('start');
  });

  it('starts when the active-run list is empty', () => {
    expect(decideRunAction([], 'agent-1')).toBe('start');
  });

  it('there is no third return value', () => {
    const outcomes = [
      decideRunAction([running('agent-1')], 'agent-1'),
      decideRunAction([running('agent-2')], 'agent-1'),
      decideRunAction([], 'agent-1'),
    ];
    expect(new Set(outcomes)).toEqual(new Set(['attach', 'start']));
  });

  it('findActiveRun returns the matching row, ignoring rows for other agents', () => {
    const rows = [running('agent-2', 'run-2'), running('agent-1', 'run-1')];
    expect(findActiveRun(rows, 'agent-1')).toEqual(rows[1]);
    expect(findActiveRun(rows, 'agent-3')).toBeUndefined();
  });
});

// ---- run/waiter.ts ----------------------------------------------------------

describe('waitForRun (§5.4, REQ-13, REQ-14, REQ-32)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls at 1.5s then every 3s, and stops as soon as a poll reports a terminal status', async () => {
    vi.useFakeTimers();
    const runningRow: RunStatus = { run_id: 'run-1', agent_id: 'agent-1', status: 'running', error: null };
    const doneRow: RunStatus = { run_id: 'run-1', agent_id: 'agent-1', status: 'done', error: null };
    const listRuns = vi
      .fn<ApiPort['listRuns']>()
      .mockResolvedValueOnce([runningRow])
      .mockResolvedValueOnce([doneRow]);
    const api = createFakeApi({ listRuns });
    const deps: RunWaiterDeps = { api, budgetMs: 90_000, sleep: realSleep, now: () => Date.now() };

    const promise = waitForRun('pull-1', 'run-1', deps);
    await vi.advanceTimersByTimeAsync(1_500);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await promise;

    expect(result).toEqual({ outcome: 'done', runStatus: doneRow });
    expect(listRuns).toHaveBeenCalledTimes(2);
  });

  it('REQ-13 — never resolves indefinitely: a poll that never resolves still returns no later than budget + one poll interval, with NO real timer', async () => {
    vi.useFakeTimers();
    const listRuns = vi.fn(() => new Promise<RunStatus[]>(() => {}));
    const api = createFakeApi({ listRuns });
    const deps: RunWaiterDeps = { api, budgetMs: 5_000, sleep: realSleep, now: () => Date.now() };

    const promise = waitForRun('pull-1', 'run-1', deps);
    const startedAt = Date.now();
    await vi.advanceTimersByTimeAsync(5_000 + 3_000);
    const result = await promise;

    expect(result).toEqual({ outcome: 'timeout' });
    expect(Date.now() - startedAt).toBeLessThanOrEqual(5_000 + 3_000);
  });

  it('REQ-14 — issues at most 31 listRuns calls over a 90s budget', async () => {
    vi.useFakeTimers();
    const runningRow: RunStatus = { run_id: 'run-1', agent_id: 'agent-1', status: 'running', error: null };
    const listRuns = vi.fn(async () => [runningRow]);
    const api = createFakeApi({ listRuns });
    const deps: RunWaiterDeps = { api, budgetMs: 90_000, sleep: realSleep, now: () => Date.now() };

    const promise = waitForRun('pull-1', 'run-1', deps);
    await vi.advanceTimersByTimeAsync(95_000);
    const result = await promise;

    expect(result).toEqual({ outcome: 'timeout' });
    expect(listRuns.mock.calls.length).toBeLessThanOrEqual(31);
  });

  it('a failed run is reported as failed, never as an empty success', async () => {
    vi.useFakeTimers();
    const failedRow: RunStatus = { run_id: 'run-1', agent_id: 'agent-1', status: 'failed', error: 'model timeout' };
    const listRuns = vi.fn(async () => [failedRow]);
    const api = createFakeApi({ listRuns });
    const deps: RunWaiterDeps = { api, budgetMs: 90_000, sleep: realSleep, now: () => Date.now() };

    const promise = waitForRun('pull-1', 'run-1', deps);
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await promise;

    expect(result).toEqual({ outcome: 'failed', runStatus: failedRow });
  });

  it('REQ-14 — no source file in this task references GET /runs/:id/events (SSE)', () => {
    const waiterSrc = readFileSync(path.join(SRC_ROOT, 'run/waiter.ts'), 'utf8');
    const toolSrc = readFileSync(path.join(SRC_ROOT, 'tools/run-agent-on-pr.ts'), 'utf8');
    expect(waiterSrc.includes('/events')).toBe(false);
    expect(toolSrc.includes('/events')).toBe(false);
  });
});

// ---- tools/run-agent-on-pr.ts ------------------------------------------------

interface CapturedTool {
  name: string;
  config: { description?: string; annotations?: unknown };
  handler: (args: unknown) => Promise<{
    content: { type: string; text: string }[];
    structuredContent: unknown;
    isError: boolean;
  }>;
}

function createFakeServer(): { server: McpServer; registered: CapturedTool[] } {
  const registered: CapturedTool[] = [];
  const fake = {
    registerTool: vi.fn((name: string, config: CapturedTool['config'], handler: CapturedTool['handler']) => {
      registered.push({ name, config, handler });
    }),
  };
  return { server: fake as unknown as McpServer, registered };
}

function buildDeps(api: ApiPort, overrides: Partial<RunAgentOnPrDeps> = {}): RunAgentOnPrDeps {
  return {
    api,
    cache: new RepoCache({ ttlMs: 5 * 60_000 }),
    now: () => Date.now(),
    budgetMs: 90_000,
    sleep: realSleep,
    ...overrides,
  };
}

describe('run_agent_on_pr — registration (§5.13.3, D-G)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers with the frozen §5.13.3 description (780 bytes) and the required annotations', () => {
    const { server, registered } = createFakeServer();
    registerRunAgentOnPr(server, buildDeps(createFakeApi()));

    expect(registered).toHaveLength(1);
    const tool = registered[0]!;
    expect(tool.name).toBe('run_agent_on_pr');
    expect(Buffer.byteLength(tool.config.description as string, 'utf8')).toBe(780);
    expect((tool.config.description as string).startsWith('Review one GitHub pull request')).toBe(true);
    expect(tool.config.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
  });

  it('REQ-12 — happy path issues exactly one startReview and returns {verdict, findings[]}', async () => {
    vi.useFakeTimers();
    const doneRow: RunStatus = { run_id: 'run-1', agent_id: 'agent-1', status: 'done', error: null };
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listAgents: vi.fn(async () => enabledAgent()),
      listActiveRuns: vi.fn(async () => []),
      startReview: vi.fn(async () => ({ runId: 'run-1' })),
      listRuns: vi.fn(async () => [doneRow]),
      listReviews: vi.fn(async () => [reviewFixture()]),
    });
    const { server, registered } = createFakeServer();
    registerRunAgentOnPr(server, buildDeps(api));

    const call = registered[0]!.handler({ repo: 'owner/name', pr: 42, agent: 'agent-1' });
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await call;

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ verdict: 'approve', findings: [] });
    expect(api.startReview).toHaveBeenCalledTimes(1);
    expect(api.startReview).toHaveBeenCalledWith('pull-1', 'agent-1');
  });

  it('REQ-15 — attaches to an in-flight run for this agent instead of starting a second one', async () => {
    vi.useFakeTimers();
    const doneRow: RunStatus = { run_id: 'run-existing', agent_id: 'agent-1', status: 'done', error: null };
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listAgents: vi.fn(async () => enabledAgent()),
      listActiveRuns: vi.fn(async () => [
        { run_id: 'run-existing', agent_id: 'agent-1', agent_name: 'Security', ran_at: null },
      ]),
      listRuns: vi.fn(async () => [doneRow]),
      listReviews: vi.fn(async () => [reviewFixture({ run_id: 'run-existing', verdict: 'comment', score: 80 })]),
    });
    const { server, registered } = createFakeServer();
    registerRunAgentOnPr(server, buildDeps(api));

    const call = registered[0]!.handler({ repo: 'owner/name', pr: 42, agent: 'agent-1' });
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await call;

    expect(result.isError).toBe(false);
    expect(api.startReview).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ verdict: 'comment' });
  });

  it("REQ-15 — a PR whose only history is a 'done' run for this agent still STARTS a new run (D-H accepts the cost)", async () => {
    vi.useFakeTimers();
    const doneRow: RunStatus = { run_id: 'run-new', agent_id: 'agent-1', status: 'done', error: null };
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listAgents: vi.fn(async () => enabledAgent()),
      // The server's own filter means a DONE run never shows up here — this
      // is what makes "never reuses a finished run" fall out of the input.
      listActiveRuns: vi.fn(async () => []),
      startReview: vi.fn(async () => ({ runId: 'run-new' })),
      listRuns: vi.fn(async () => [doneRow]),
      listReviews: vi.fn(async () => [reviewFixture({ run_id: 'run-new', score: 90 })]),
    });
    const { server, registered } = createFakeServer();
    registerRunAgentOnPr(server, buildDeps(api));

    const call = registered[0]!.handler({ repo: 'owner/name', pr: 42, agent: 'agent-1' });
    await vi.advanceTimersByTimeAsync(1_500);
    await call;

    expect(api.startReview).toHaveBeenCalledTimes(1);
  });

  it('REQ-13 — with the run still running at the budget, returns {run_id, status:"running", poll_with:"get_findings"} with isError:false', async () => {
    vi.useFakeTimers();
    const runningRow: RunStatus = { run_id: 'run-1', agent_id: 'agent-1', status: 'running', error: null };
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listAgents: vi.fn(async () => enabledAgent()),
      listActiveRuns: vi.fn(async () => []),
      startReview: vi.fn(async () => ({ runId: 'run-1' })),
      listRuns: vi.fn(async () => [runningRow]),
    });
    const { server, registered } = createFakeServer();
    registerRunAgentOnPr(server, buildDeps(api, { budgetMs: 5_000 }));

    const call = registered[0]!.handler({ repo: 'owner/name', pr: 42, agent: 'agent-1' });
    await vi.advanceTimersByTimeAsync(5_000 + 3_000);
    const result = await call;

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({ run_id: 'run-1', status: 'running', poll_with: 'get_findings' });
    expect(result.content[0]?.text).toContain('get_findings');
  });

  it('a failed run is an isError result naming a next step, never {findings: []}', async () => {
    vi.useFakeTimers();
    const failedRow: RunStatus = { run_id: 'run-1', agent_id: 'agent-1', status: 'failed', error: 'model timeout' };
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listAgents: vi.fn(async () => enabledAgent()),
      listActiveRuns: vi.fn(async () => []),
      startReview: vi.fn(async () => ({ runId: 'run-1' })),
      listRuns: vi.fn(async () => [failedRow]),
    });
    const { server, registered } = createFakeServer();
    registerRunAgentOnPr(server, buildDeps(api));

    const call = registered[0]!.handler({ repo: 'owner/name', pr: 42, agent: 'agent-1' });
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await call;

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('model timeout');
    expect(result.content[0]?.text).toContain('list_agents');
    expect(result.structuredContent).not.toHaveProperty('findings');
  });

  it('an unresolvable repo produces the resolver catalogue message, not {findings: []}', async () => {
    const api = createFakeApi({
      lookupPull: vi.fn(async () => ({
        ok: false as const,
        reason: 'repo_not_found' as const,
        message: 'nope',
        candidates: [],
      })),
    });
    const { server, registered } = createFakeServer();
    registerRunAgentOnPr(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/missing', pr: 1, agent: 'agent-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('owner/missing');
    expect(result.structuredContent).toEqual({});
    expect(api.listActiveRuns).not.toHaveBeenCalled();
  });

  it('an unknown agent produces the "call list_agents" message and starts nothing', async () => {
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listAgents: vi.fn(async () => []),
    });
    const { server, registered } = createFakeServer();
    registerRunAgentOnPr(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42, agent: 'nonexistent' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('list_agents');
    expect(api.listActiveRuns).not.toHaveBeenCalled();
  });
});
