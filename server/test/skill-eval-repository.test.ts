/**
 * Hermetic tests for `SkillEvalRepository` — the skill-eval pipeline's
 * run/batch/history queries (sibling to L06's `EvalRepository`, see
 * docs/plans/2026-07-06-skill-eval-pipeline.md Step 4). Every method must be
 * workspace-scoped, either directly (`skill_eval_batches` has its own
 * `workspace_id` column) or transitively (`eval_runs`/case reads have no
 * `workspace_id` of their own — scope flows via a `skillId`/`batchId` the
 * caller already resolved).
 *
 * A hand-rolled fake `Db` satisfies the exact Drizzle chain shapes
 * `SkillEvalRepository` calls, following the "sniff by requested column
 * keys" / call-recording chain-shape convention documented in
 * `server/insights.md` and used by `test/eval-repository.test.ts`. No
 * Postgres, no Docker.
 */
import { describe, it, expect, vi } from 'vitest';
import { Column } from 'drizzle-orm';
import type { SQL, SQLChunk } from 'drizzle-orm';
import { SkillEvalRepository } from '../src/modules/skills/eval-repository.js';
import type { Db } from '../src/db/client.js';

const WS_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_WS_ID = '99999999-9999-9999-9999-999999999999';
const SKILL_ID = '22222222-2222-2222-2222-222222222222';
const HOST_AGENT_ID = '66666666-6666-6666-6666-666666666666';
const CASE_ID = '33333333-3333-3333-3333-333333333333';
const BATCH_ID = '44444444-4444-4444-4444-444444444444';

const CASE_ROW = {
  id: CASE_ID,
  workspaceId: WS_ID,
  ownerKind: 'skill' as const,
  ownerId: SKILL_ID,
  name: 'case one',
  inputDiff: 'diff --git a/x b/x',
  inputFiles: null,
  inputMeta: null,
  expectedOutput: { practices: ['does X'], grounding: ['term'], threshold: 0.6 },
  notes: null,
};

const BATCH_ROW = {
  id: BATCH_ID,
  workspaceId: WS_ID,
  skillId: SKILL_ID,
  hostAgentId: HOST_AGENT_ID,
  kind: 'full' as const,
  status: 'clean' as const,
  snapshotIdentity: {},
  model: 'claude-haiku-4-5',
  judgeScore: 0.9,
  groundingPassRate: 1,
  casesPassing: 1,
  casesTotal: 1,
  costUsd: 0.01,
  ranAt: new Date('2026-07-06T00:00:00Z'),
};

const RUN_ROW = {
  id: '55555555-5555-5555-5555-555555555555',
  caseId: CASE_ID,
  ranAt: new Date('2026-07-06T00:00:00Z'),
  actualOutput: {},
  pass: true,
  recall: null,
  precision: null,
  citationAccuracy: null,
  durationMs: 100,
  costUsd: 0.01,
  batchId: null,
  skillBatchId: BATCH_ID,
  matchedCount: null,
  expectedCount: null,
  errorMessage: null,
};

/**
 * Generic chainable select() spy. `resolve` supplies the terminal row array;
 * `where`/`orderBy`/`limit` are recorded on `calls` so tests can assert the
 * WHERE clause was invoked without needing a real SQL parser (mirrors
 * `eval-repository.test.ts`'s `selectChain`/`makeSelectOnlyDb` convention).
 */
function selectChain(rows: unknown[], calls: { where: unknown[] }) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: (...args: unknown[]) => {
      calls.where.push(args);
      return chain;
    },
    orderBy: () => chain,
    limit: (_n: number) => Promise.resolve(rows),
    then: (onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(onF, onR),
  };
  return chain;
}

function makeSelectOnlyDb(rows: unknown[]): { db: Db; calls: { where: unknown[] } } {
  const calls = { where: [] as unknown[] };
  const db = {
    select: (_cols?: Record<string, unknown>) => selectChain(rows, calls),
  } as unknown as Db;
  return { db, calls };
}

describe('SkillEvalRepository.listCases', () => {
  it('scopes by workspace_id + owner_kind=skill + owner_id', async () => {
    const { db, calls } = makeSelectOnlyDb([CASE_ROW]);
    const repo = new SkillEvalRepository(db);
    const rows = await repo.listCases(WS_ID, SKILL_ID);
    expect(rows).toEqual([CASE_ROW]);
    expect(calls.where.length).toBe(1);
  });

  it('returns empty array when no cases match', async () => {
    const { db } = makeSelectOnlyDb([]);
    const repo = new SkillEvalRepository(db);
    const rows = await repo.listCases(OTHER_WS_ID, SKILL_ID);
    expect(rows).toEqual([]);
  });
});

describe('SkillEvalRepository.getCase', () => {
  it('returns the row when it exists in the workspace with owner_kind=skill', async () => {
    const { db, calls } = makeSelectOnlyDb([CASE_ROW]);
    const repo = new SkillEvalRepository(db);
    const row = await repo.getCase(WS_ID, CASE_ID);
    expect(row).toEqual(CASE_ROW);
    expect(calls.where.length).toBe(1);

    // Assert the actual scoping eq-pairs, not just that a WHERE was called —
    // otherwise the `owner_kind = 'skill'` literal is untested (a
    // StringLiteral mutant `'skill' → ''` survives, since the fake db returns
    // the seeded row regardless of the condition). Mirrors listTrendBatches.
    const pairs = extractEqPairs(calls.where[0]![0]);
    expect(pairs.id).toBe(CASE_ID);
    expect(pairs.workspace_id).toBe(WS_ID);
    expect(pairs.owner_kind).toBe('skill');
  });

  it('returns null for a cross-workspace / nonexistent case', async () => {
    const { db } = makeSelectOnlyDb([]);
    const repo = new SkillEvalRepository(db);
    const row = await repo.getCase(OTHER_WS_ID, CASE_ID);
    expect(row).toBeNull();
  });
});

describe('SkillEvalRepository.latestRunForCase', () => {
  it('returns the most recent skill-eval run row for the case', async () => {
    const { db } = makeSelectOnlyDb([RUN_ROW]);
    const repo = new SkillEvalRepository(db);
    const row = await repo.latestRunForCase(CASE_ID);
    expect(row).toEqual(RUN_ROW);
  });

  it('returns null when the case has never run under a skill-eval batch', async () => {
    const { db } = makeSelectOnlyDb([]);
    const repo = new SkillEvalRepository(db);
    expect(await repo.latestRunForCase(CASE_ID)).toBeNull();
  });
});

describe('SkillEvalRepository.insertRun', () => {
  it('returns the inserted row including skill_batch_id, with batch_id left null', async () => {
    const values = vi.fn();
    const db = {
      insert: () => ({
        values: (v: unknown) => {
          values(v);
          return { returning: () => Promise.resolve([RUN_ROW]) };
        },
      }),
    } as unknown as Db;
    const repo = new SkillEvalRepository(db);
    const row = await repo.insertRun({ caseId: CASE_ID, skillBatchId: BATCH_ID, batchId: null, pass: true });
    expect(row).toEqual(RUN_ROW);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ skillBatchId: BATCH_ID, batchId: null }),
    );
  });

  it('throws when the insert returns no row', async () => {
    const db = {
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    } as unknown as Db;
    const repo = new SkillEvalRepository(db);
    await expect(repo.insertRun({ caseId: CASE_ID, skillBatchId: BATCH_ID })).rejects.toThrow(
      'insertRun: insert returned no row',
    );
  });
});

describe('SkillEvalRepository.runsForBatch', () => {
  it('returns all runs scoped by skill_batch_id', async () => {
    const { db, calls } = makeSelectOnlyDb([RUN_ROW]);
    const repo = new SkillEvalRepository(db);
    expect(await repo.runsForBatch(BATCH_ID)).toEqual([RUN_ROW]);
    expect(calls.where.length).toBe(1);
  });
});

describe('SkillEvalRepository.insertBatch', () => {
  it('returns the inserted batch row', async () => {
    const db = {
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([BATCH_ROW]) }) }),
    } as unknown as Db;
    const repo = new SkillEvalRepository(db);
    const row = await repo.insertBatch({
      workspaceId: WS_ID,
      skillId: SKILL_ID,
      hostAgentId: HOST_AGENT_ID,
      kind: 'full',
      snapshotIdentity: {},
      model: 'claude-haiku-4-5',
    });
    expect(row).toEqual(BATCH_ROW);
  });

  it('throws when the insert returns no row', async () => {
    const db = {
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    } as unknown as Db;
    const repo = new SkillEvalRepository(db);
    await expect(
      repo.insertBatch({
        workspaceId: WS_ID,
        skillId: SKILL_ID,
        hostAgentId: HOST_AGENT_ID,
        kind: 'full',
        snapshotIdentity: {},
        model: 'claude-haiku-4-5',
      }),
    ).rejects.toThrow('insertBatch: insert returned no row');
  });
});

describe('SkillEvalRepository.updateBatchAggregate', () => {
  it('writes judgeScore/groundingPassRate/casesPassing/casesTotal/costUsd/status by batch id', async () => {
    const setSpy = vi.fn();
    const whereSpy = vi.fn();
    const db = {
      update: () => ({
        set: (vals: unknown) => {
          setSpy(vals);
          return {
            where: (...args: unknown[]) => {
              whereSpy(...args);
              return Promise.resolve();
            },
          };
        },
      }),
    } as unknown as Db;
    const repo = new SkillEvalRepository(db);
    await repo.updateBatchAggregate(BATCH_ID, {
      judgeScore: 0.9,
      groundingPassRate: 1,
      casesPassing: 1,
      casesTotal: 1,
      costUsd: 0.02,
      status: 'clean',
    });
    expect(setSpy).toHaveBeenCalledWith({
      judgeScore: 0.9,
      groundingPassRate: 1,
      casesPassing: 1,
      casesTotal: 1,
      costUsd: 0.02,
      status: 'clean',
    });
    expect(whereSpy).toHaveBeenCalledTimes(1);
  });
});

describe('SkillEvalRepository.listBatchHistory', () => {
  it('scopes by workspace_id + skill_id', async () => {
    const { db, calls } = makeSelectOnlyDb([BATCH_ROW]);
    const repo = new SkillEvalRepository(db);
    const rows = await repo.listBatchHistory(WS_ID, SKILL_ID);
    expect(rows).toEqual([BATCH_ROW]);
    expect(calls.where.length).toBe(1);
  });

  it('returns empty array when the skill has no batch history yet', async () => {
    const { db } = makeSelectOnlyDb([]);
    const repo = new SkillEvalRepository(db);
    expect(await repo.listBatchHistory(OTHER_WS_ID, SKILL_ID)).toEqual([]);
  });
});

describe('SkillEvalRepository.getBatch', () => {
  it('returns the row when it belongs to the workspace', async () => {
    const { db } = makeSelectOnlyDb([BATCH_ROW]);
    const repo = new SkillEvalRepository(db);
    expect(await repo.getBatch(WS_ID, BATCH_ID)).toEqual(BATCH_ROW);
  });

  it('returns null for a cross-workspace batch id', async () => {
    const { db } = makeSelectOnlyDb([]);
    const repo = new SkillEvalRepository(db);
    expect(await repo.getBatch(OTHER_WS_ID, BATCH_ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listTrendBatches / previousFullBatch — mirrors eval/repository.ts exactly
// (full-kind + status IS NOT NULL only; excludes calibration/unsealed rows).
// The generic `selectChain`/`makeSelectOnlyDb` fake above can't express a
// filtered result set (it always resolves whatever `rows` array it was given
// regardless of the WHERE clause), so these tests assert the QUERY SHAPE
// (kind='full', status IS NOT NULL, workspace/skill scoping) by inspecting
// each recorded `where()` call's real drizzle-orm SQL tree, the same
// `extractEqPairs`-based approach used for `clearHistory` below.
// ---------------------------------------------------------------------------

describe('SkillEvalRepository.listTrendBatches', () => {
  it('scopes by workspace_id + skill_id + kind=full + status IS NOT NULL', async () => {
    const { db, calls } = makeSelectOnlyDb([BATCH_ROW]);
    const repo = new SkillEvalRepository(db);
    const rows = await repo.listTrendBatches(WS_ID, SKILL_ID);
    expect(rows).toEqual([BATCH_ROW]);
    expect(calls.where.length).toBe(1);

    const cond = calls.where[0]![0];
    const pairs = extractEqPairs(cond);
    expect(pairs.workspace_id).toBe(WS_ID);
    expect(pairs.skill_id).toBe(SKILL_ID);
    expect(pairs.kind).toBe('full');
    expect(sqlText(cond)).toContain('is not null');
  });

  it('returns empty when there are no full, sealed batches yet', async () => {
    const { db } = makeSelectOnlyDb([]);
    const repo = new SkillEvalRepository(db);
    expect(await repo.listTrendBatches(WS_ID, SKILL_ID)).toEqual([]);
  });
});

describe('SkillEvalRepository.previousFullBatch', () => {
  it('scopes by workspace_id + skill_id + kind=full + status IS NOT NULL + ran_at < beforeRanAt (strict)', async () => {
    const { db, calls } = makeSelectOnlyDb([BATCH_ROW]);
    const repo = new SkillEvalRepository(db);
    const beforeRanAt = new Date('2026-07-06T12:00:00Z');
    const row = await repo.previousFullBatch(WS_ID, SKILL_ID, beforeRanAt);
    expect(row).toEqual(BATCH_ROW);
    expect(calls.where.length).toBe(1);

    const cond = calls.where[0]![0];
    const pairs = extractEqPairs(cond);
    expect(pairs.workspace_id).toBe(WS_ID);
    expect(pairs.skill_id).toBe(SKILL_ID);
    expect(pairs.kind).toBe('full');
    expect(sqlText(cond)).toContain('is not null');
    expect(sqlText(cond)).toContain('<');
  });

  it('returns null when there is no earlier full, sealed batch', async () => {
    const { db } = makeSelectOnlyDb([]);
    const repo = new SkillEvalRepository(db);
    expect(await repo.previousFullBatch(WS_ID, SKILL_ID, new Date('2026-07-06T12:00:00Z'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SkillEvalRepository.clearHistory — genuinely stateful in-memory fake (not a
// call-recording spy chain): this method's correctness hinges on ACTUAL
// filtering (which rows survive vs. get deleted, and isolation from a
// different skill/workspace's rows), which a spy-only chain can't assert.
// Ported verbatim from `test/eval-repository.test.ts`'s `clearHistory` fixture
// (`extractEqPairs`/`makeStatefulEvalDb` convention, per `server/insights.md`'s
// 2026-07-06 Pattern entry).
// ---------------------------------------------------------------------------

/** Recursively collect `{columnName: value}` pairs out of a real drizzle `eq`/`and` SQL tree. */
function extractEqPairs(node: unknown): Record<string, unknown> {
  const pairs: Record<string, unknown> = {};

  function walk(chunks: SQLChunk[]): void {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk instanceof Column) {
        const maybeValueChunk = chunks[i + 2] as unknown;
        const value = extractBoundValue(maybeValueChunk);
        if (value !== undefined) pairs[chunk.name] = value;
      } else if (isSqlLike(chunk)) {
        walk((chunk as SQL).queryChunks);
      }
    }
  }

  function isSqlLike(x: unknown): x is SQL {
    return !!x && typeof x === 'object' && Array.isArray((x as SQL).queryChunks);
  }

  function extractBoundValue(x: unknown): unknown {
    if (x && typeof x === 'object' && 'value' in (x as Record<string, unknown>)) {
      return (x as { value: unknown }).value;
    }
    return x;
  }

  if (isSqlLike(node)) walk((node as SQL).queryChunks);
  return pairs;
}

/** Flatten a drizzle SQL tree's raw string chunks for a coarse substring
 *  check (e.g. "is not null", "<") — used only to assert query SHAPE, not
 *  bound values (those are covered by `extractEqPairs`). Raw-text SQL chunks
 *  surface as `{value: [' is not null']}` (an array-wrapped string), distinct
 *  from a bound `eq()`/`lt()` value which is `{value: <the actual value>}`. */
function sqlText(node: unknown): string {
  const parts: string[] = [];
  function walk(x: unknown): void {
    if (!x || typeof x !== 'object') return;
    const chunks = (x as SQL).queryChunks;
    if (!Array.isArray(chunks)) return;
    for (const chunk of chunks) {
      if (chunk instanceof Column) continue;
      if (chunk && typeof chunk === 'object' && Array.isArray((chunk as SQL).queryChunks)) {
        walk(chunk);
      } else if (chunk && typeof chunk === 'object' && 'value' in (chunk as Record<string, unknown>)) {
        const v = (chunk as { value: unknown }).value;
        if (typeof v === 'string') parts.push(v.toLowerCase());
        else if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item === 'string') parts.push(item.toLowerCase());
          }
        }
      }
    }
  }
  walk(node);
  return parts.join(' ');
}

interface FakeRow {
  [key: string]: unknown;
}

/**
 * A genuinely stateful fake `Db` for `clearHistory`: holds in-memory
 * `evalCases`/`evalRuns`/`skillEvalBatches` arrays and implements just the
 * `transaction/select/delete/where/returning` surface the method calls,
 * filtering by the REAL eq-pairs extracted from the condition passed to
 * `where()` (not a hardcoded resolve — genuine predicate evaluation).
 */
function makeStatefulEvalDb(seed: { cases: FakeRow[]; runs: FakeRow[]; batches: FakeRow[] }) {
  const state = {
    cases: [...seed.cases],
    runs: [...seed.runs],
    batches: [...seed.batches],
  };

  /** `extractEqPairs` keys are the real DB column names (snake_case, e.g.
   *  `workspace_id`); the in-memory fixture rows use the Drizzle JS field
   *  names (camelCase, e.g. `workspaceId`) — convert before comparing. */
  function snakeToCamel(s: string): string {
    return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  }

  function matches(row: FakeRow, pairs: Record<string, unknown>): boolean {
    return Object.entries(pairs).every(([k, v]) => row[snakeToCamel(k)] === v);
  }

  function makeTx() {
    // `clearHistory` issues its two `delete()` calls in a FIXED order —
    // eval_runs first (via the eval_cases subquery), then skill_eval_batches
    // — so a simple call-order counter distinguishes them without needing to
    // compare table object identity (this fake never imports the real schema
    // module).
    let deleteCallCount = 0;

    return {
      select: (_cols: { id: unknown }) => ({
        from: (table: { [k: string]: unknown }) => {
          // Only ever called against evalCases in clearHistory.
          void table;
          return {
            where: (cond: unknown) => {
              const pairs = extractEqPairs(cond);
              const rows = state.cases.filter((r) => matches(r, pairs));
              const result = rows.map((r) => ({ id: r.id }));
              return Object.assign(Promise.resolve(result), {
                then: (onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
                  Promise.resolve(result).then(onF, onR),
              });
            },
          };
        },
      }),
      delete: (_table: unknown) => {
        const isRuns = deleteCallCount === 0;
        deleteCallCount++;
        return {
          where: (cond: unknown) => ({
            returning: async (_sel: unknown) => {
              if (isRuns) {
                const caseIds = await resolveInArraySubquery(cond);
                const toDelete = state.runs.filter((r) => caseIds.includes(r.caseId as string));
                state.runs = state.runs.filter((r) => !caseIds.includes(r.caseId as string));
                return toDelete.map((r) => ({ id: r.id }));
              }
              const pairs = extractEqPairs(cond);
              const toDelete = state.batches.filter((r) => matches(r, pairs));
              state.batches = state.batches.filter((r) => !matches(r, pairs));
              return toDelete.map((r) => ({ id: r.id }));
            },
          }),
        };
      },
    };
  }

  async function resolveInArraySubquery(cond: unknown): Promise<string[]> {
    const sqlCond = cond as SQL;
    for (const chunk of sqlCond.queryChunks) {
      const candidate =
        chunk && typeof chunk === 'object' && 'value' in (chunk as Record<string, unknown>)
          ? (chunk as { value: unknown }).value
          : chunk;
      if (candidate && typeof (candidate as Promise<unknown>).then === 'function') {
        const rows = (await (candidate as Promise<{ id: string }[]>)) ?? [];
        return rows.map((r) => r.id);
      }
    }
    return [];
  }

  const db = {
    transaction: async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx()),
  } as unknown as Db;

  return { db, state };
}

describe('SkillEvalRepository.clearHistory', () => {
  const CASE_A_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
  const CASE_B_ID = 'aaaaaaaa-0000-0000-0000-000000000002';
  const OTHER_SKILL_CASE_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
  const OTHER_WS_CASE_ID = 'cccccccc-0000-0000-0000-000000000001';

  const OTHER_SKILL_ID = 'dddddddd-0000-0000-0000-000000000001';

  function seedData() {
    return {
      cases: [
        { id: CASE_A_ID, workspaceId: WS_ID, ownerKind: 'skill', ownerId: SKILL_ID, name: 'a' },
        { id: CASE_B_ID, workspaceId: WS_ID, ownerKind: 'skill', ownerId: SKILL_ID, name: 'b' },
        // Different skill, SAME workspace — must survive + its runs/batches untouched.
        { id: OTHER_SKILL_CASE_ID, workspaceId: WS_ID, ownerKind: 'skill', ownerId: OTHER_SKILL_ID, name: 'c' },
        // Different workspace entirely.
        { id: OTHER_WS_CASE_ID, workspaceId: OTHER_WS_ID, ownerKind: 'skill', ownerId: SKILL_ID, name: 'd' },
      ],
      runs: [
        { id: 'run-1', caseId: CASE_A_ID, skillBatchId: BATCH_ID, pass: true },
        { id: 'run-2', caseId: CASE_B_ID, skillBatchId: BATCH_ID, pass: false },
        { id: 'run-3', caseId: OTHER_SKILL_CASE_ID, skillBatchId: 'batch-other-skill', pass: true },
        { id: 'run-4', caseId: OTHER_WS_CASE_ID, skillBatchId: 'batch-other-ws', pass: true },
      ],
      batches: [
        { id: BATCH_ID, workspaceId: WS_ID, skillId: SKILL_ID, kind: 'full' },
        { id: 'batch-other-skill', workspaceId: WS_ID, skillId: OTHER_SKILL_ID, kind: 'full' },
        { id: 'batch-other-ws', workspaceId: OTHER_WS_ID, skillId: SKILL_ID, kind: 'full' },
      ],
    };
  }

  it('deletes all batches + runs for the skill, returning accurate counts', async () => {
    const { db, state } = makeStatefulEvalDb(seedData());
    const repo = new SkillEvalRepository(db);

    const result = await repo.clearHistory(WS_ID, SKILL_ID);

    expect(result).toEqual({ deletedBatches: 1, deletedRuns: 2 });
    expect(state.batches.some((b) => b.skillId === SKILL_ID && b.workspaceId === WS_ID)).toBe(false);
    expect(state.runs.some((r) => r.caseId === CASE_A_ID || r.caseId === CASE_B_ID)).toBe(false);
  });

  it('preserves the eval_cases rows themselves — case definitions survive', async () => {
    const { db, state } = makeStatefulEvalDb(seedData());
    const repo = new SkillEvalRepository(db);

    await repo.clearHistory(WS_ID, SKILL_ID);

    // clearHistory never deletes from `cases` — all 4 seeded cases remain,
    // including the target skill's own two.
    expect(state.cases).toHaveLength(4);
    expect(state.cases.some((c) => c.id === CASE_A_ID)).toBe(true);
    expect(state.cases.some((c) => c.id === CASE_B_ID)).toBe(true);
  });

  it("does not touch a different skill's batches/runs in the SAME workspace (isolation)", async () => {
    const { db, state } = makeStatefulEvalDb(seedData());
    const repo = new SkillEvalRepository(db);

    await repo.clearHistory(WS_ID, SKILL_ID);

    expect(state.batches.some((b) => b.id === 'batch-other-skill')).toBe(true);
    expect(state.runs.some((r) => r.id === 'run-3')).toBe(true);
  });

  it("does not touch a different workspace's batches/runs for the SAME skill id (isolation)", async () => {
    const { db, state } = makeStatefulEvalDb(seedData());
    const repo = new SkillEvalRepository(db);

    await repo.clearHistory(WS_ID, SKILL_ID);

    expect(state.batches.some((b) => b.id === 'batch-other-ws')).toBe(true);
    expect(state.runs.some((r) => r.id === 'run-4')).toBe(true);
  });

  it('returns zero counts when the skill has no history yet', async () => {
    const { db } = makeStatefulEvalDb({ cases: [], runs: [], batches: [] });
    const repo = new SkillEvalRepository(db);

    const result = await repo.clearHistory(WS_ID, SKILL_ID);
    expect(result).toEqual({ deletedBatches: 0, deletedRuns: 0 });
  });
});
