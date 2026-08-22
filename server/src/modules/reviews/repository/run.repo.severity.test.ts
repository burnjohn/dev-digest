/**
 * listRunsForPull — per-severity counts aggregation.
 *
 * The function runs two queries:
 *   1. agent_runs + agents JOIN → run rows
 *   2. findings JOIN reviews → severity counts grouped by run_id
 *
 * These tests mock the drizzle DB to verify the aggregation logic:
 * - CRITICAL/WARNING/SUGGESTION counts land on the correct run
 * - Runs with no findings get counts of 0 (not null)
 * - Empty run list skips the second query entirely
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { listRunsForPull } from './run.repo.js';
import type { Db } from '../../../db/client.js';

afterEach(() => vi.restoreAllMocks());

/** Build a minimal agent_run row as returned by drizzle. */
function runRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    run: {
      id,
      agentId: 'agent-1',
      ranAt: new Date('2026-06-18T00:00:00Z'),
      provider: 'openrouter',
      model: 'deepseek/v3',
      status: 'done',
      error: null,
      durationMs: 1000,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: null,
      findingsCount: 0,
      grounding: '0/0',
      score: null,
      blockers: null,
      ...overrides,
    },
    agentName: 'Test Agent',
  };
}

/** Build a severity-count row as returned by the second query. */
function sevRow(runId: string, severity: string, count: number) {
  return { runId, severity, count };
}

/** Create a mock drizzle DB that returns `firstResult` for the first `.select()`
 *  call chain and `secondResult` for the second. */
function makeDb(firstResult: unknown[], secondResult: unknown[]): Db {
  let call = 0;
  const makeChain = (result: unknown[]) => {
    const end = vi.fn().mockResolvedValue(result);
    return {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: end,   // first query ends with orderBy
      groupBy: end,   // second query ends with groupBy
    };
  };

  return {
    select: vi.fn().mockImplementation(() => {
      call += 1;
      return makeChain(call === 1 ? firstResult : secondResult);
    }),
  } as unknown as Db;
}

// ────────────────────────────────────────────────────────────────────────────

describe('listRunsForPull — severity aggregation', () => {
  it('maps CRITICAL/WARNING/SUGGESTION counts to the correct run', async () => {
    const db = makeDb(
      [runRow('run-1')],
      [
        sevRow('run-1', 'CRITICAL', 2),
        sevRow('run-1', 'WARNING', 3),
        sevRow('run-1', 'SUGGESTION', 1),
      ],
    );

    const [result] = await listRunsForPull(db, 'ws-1', 'pr-1');

    expect(result.findings_critical).toBe(2);
    expect(result.findings_warning).toBe(3);
    expect(result.findings_suggestion).toBe(1);
  });

  it('returns 0 for severities not present in findings', async () => {
    const db = makeDb(
      [runRow('run-1')],
      [sevRow('run-1', 'CRITICAL', 4)],
    );

    const [result] = await listRunsForPull(db, 'ws-1', 'pr-1');

    expect(result.findings_critical).toBe(4);
    expect(result.findings_warning).toBe(0);
    expect(result.findings_suggestion).toBe(0);
  });

  it('assigns counts only to the matching run (multiple runs)', async () => {
    const db = makeDb(
      [runRow('run-1'), runRow('run-2')],
      [
        sevRow('run-1', 'CRITICAL', 1),
        sevRow('run-2', 'WARNING', 5),
      ],
    );

    const results = await listRunsForPull(db, 'ws-1', 'pr-1');
    const r1 = results.find((r) => r.run_id === 'run-1')!;
    const r2 = results.find((r) => r.run_id === 'run-2')!;

    expect(r1.findings_critical).toBe(1);
    expect(r1.findings_warning).toBe(0);

    expect(r2.findings_critical).toBe(0);
    expect(r2.findings_warning).toBe(5);
  });

  it('skips the second query and returns empty array when there are no runs', async () => {
    const db = makeDb([], []);

    const results = await listRunsForPull(db, 'ws-1', 'pr-1');

    expect(results).toHaveLength(0);
    // select() called exactly once (only the first query)
    expect((db.select as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('all severity counts are 0 when second query returns no rows', async () => {
    const db = makeDb([runRow('run-1')], []);

    const [result] = await listRunsForPull(db, 'ws-1', 'pr-1');

    expect(result.findings_critical).toBe(0);
    expect(result.findings_warning).toBe(0);
    expect(result.findings_suggestion).toBe(0);
  });
});
