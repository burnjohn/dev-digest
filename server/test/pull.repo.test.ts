/**
 * Hermetic tests for `pull.repo.ts`'s `upsertBrief` / `upsertLlmBrief` split
 * (PR Why + Risk Brief, plan Step 2).
 *
 * A hand-rolled fake `Db` satisfies the exact Drizzle chain shape both
 * functions call inside `db.transaction()` — `select().from().where().for('update')`
 * — mirroring `test/onboarding-repository.test.ts`'s `makeFakeDb` pattern.
 * No Postgres, no Docker.
 *
 * NOTE: the true row-lock CONCURRENCY behavior (a review-completion and a
 * Regenerate click racing on the same PR) is NOT hermetically testable — a
 * mock cannot model Postgres's `FOR UPDATE` blocking semantics. That test
 * lives in Step 10's `brief-generator.it.test.ts` against a real Postgres
 * connection. This file covers only sequential preserve-on-write correctness.
 */
import { describe, it, expect } from 'vitest';
import { upsertBrief, upsertLlmBrief } from '../src/modules/reviews/repository/pull.repo.js';
import type { Db } from '../src/db/client.js';
import type { PrBrief, LlmBrief } from '@devdigest/shared';

const PR_ID = '11111111-1111-1111-1111-111111111111';

function makeDeterministicBrief(overrides: Partial<PrBrief> = {}): PrBrief {
  return {
    intent: { intent: 'Add rate limiting', in_scope: ['a'], out_of_scope: [] },
    blast: { changed_symbols: [], downstream: [], summary: '' },
    risks: { risks: [] },
    history: { history: [] },
    llm: null,
    ...overrides,
  };
}

function makeLlmBrief(overrides: Partial<LlmBrief> = {}): LlmBrief {
  return {
    what: 'Adds a rate limiter middleware',
    why: 'Prevent abuse of the login endpoint',
    risk_level: 'medium',
    review_focus: [],
    generated_at: '2026-07-03T00:00:00Z',
    cost_usd: 0.01,
    tokens_in: 100,
    tokens_out: 50,
    ...overrides,
  };
}

/**
 * Builds a fake `Db` whose `.transaction()` runs the callback against a `tx`
 * exposing `select().from().where().for('update')` (resolving to `existingRow`,
 * or `[]` when absent), plus `insert().values().onConflictDoUpdate()` and
 * `update().set().where()` — the exact chain shapes both `upsertBrief` and
 * `upsertLlmBrief` call.
 */
function makeFakeDb(opts: {
  existingRow?: { json: unknown } | null;
  onInsert?: (values: { prId: string; json: unknown }) => void;
  onUpdate?: (values: { json: unknown }) => void;
}): Db {
  const fakeDb = {
    // Neither function under test calls top-level select/insert/update
    // directly — only inside the transaction callback. Fail loudly if that
    // assumption is ever violated by a future edit.
    select: () => {
      throw new Error('top-level select should not be used — all reads happen inside db.transaction()');
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: (_cols?: Record<string, unknown>) => ({
          from: () => ({
            where: () => ({
              for: (_strength: string) => {
                const row = 'existingRow' in opts ? opts.existingRow : null;
                return Promise.resolve(row ? [row] : []);
              },
            }),
          }),
        }),
        insert: (_table: unknown) => ({
          values: (values: { prId: string; json: unknown }) => {
            opts.onInsert?.(values);
            return {
              onConflictDoUpdate: (_conf: unknown) => Promise.resolve(undefined),
            };
          },
        }),
        update: (_table: unknown) => ({
          set: (values: { json: unknown }) => {
            opts.onUpdate?.(values);
            return { where: () => Promise.resolve(undefined) };
          },
        }),
      };
      return cb(tx);
    },
  };

  return fakeDb as unknown as Db;
}

describe('upsertBrief — preserves a prior llm key on write (AC-10 sequential case)', () => {
  it('carries over the existing llm field when the new deterministic brief has none', async () => {
    const priorLlm = makeLlmBrief();
    const priorBrief = makeDeterministicBrief({ llm: priorLlm });

    let insertedJson: unknown;
    const db = makeFakeDb({
      existingRow: { json: priorBrief },
      onInsert: (values) => {
        insertedJson = values.json;
      },
    });

    const newDeterministicBrief = makeDeterministicBrief({
      intent: { intent: 'Updated intent from a new review run', in_scope: [], out_of_scope: [] },
      llm: null, // the auto-composer never sets llm itself
    });

    await upsertBrief(db, PR_ID, newDeterministicBrief);

    expect(insertedJson).toMatchObject({
      intent: { intent: 'Updated intent from a new review run' },
      llm: priorLlm,
    });
  });

  it('does not clobber llm with null when no prior row exists at all', async () => {
    let insertedJson: unknown;
    const db = makeFakeDb({
      existingRow: null,
      onInsert: (values) => {
        insertedJson = values.json;
      },
    });

    const brief = makeDeterministicBrief({ llm: null });
    await upsertBrief(db, PR_ID, brief);

    expect(insertedJson).toMatchObject({ llm: null });
  });

  it('a pre-feature row with no llm key at all does not throw (safeParse, not parse)', async () => {
    // Simulates a row written before this feature existed — no `llm` key
    // present in the stored JSON whatsoever.
    const preFeatureRow = {
      intent: { intent: 'Old intent', in_scope: [], out_of_scope: [] },
      blast: { changed_symbols: [], downstream: [], summary: '' },
      risks: { risks: [] },
      history: { history: [] },
      // no `llm` key
    };

    let insertedJson: unknown;
    const db = makeFakeDb({
      existingRow: { json: preFeatureRow },
      onInsert: (values) => {
        insertedJson = values.json;
      },
    });

    const newBrief = makeDeterministicBrief({ llm: null });
    await expect(upsertBrief(db, PR_ID, newBrief)).resolves.not.toThrow();
    expect(insertedJson).toMatchObject({ llm: null });
  });
});

describe('upsertLlmBrief — no existing pr_brief row (spec §16 "no prior review" edge case)', () => {
  it('creates a well-formed PrBrief shell with empty deterministic sections', async () => {
    let insertedJson: unknown;
    const db = makeFakeDb({
      existingRow: null,
      onInsert: (values) => {
        insertedJson = values.json;
      },
    });

    const llm = makeLlmBrief();
    const result = await upsertLlmBrief(db, PR_ID, llm);

    expect(result).toEqual({
      intent: { intent: '', in_scope: [], out_of_scope: [] },
      blast: { changed_symbols: [], downstream: [], summary: '' },
      risks: { risks: [] },
      history: { history: [] },
      llm,
    });
    expect(insertedJson).toEqual(result);
  });

  it('seeds risks.risks from enrichedRisks when provided alongside a missing row', async () => {
    const enrichedRisks = [
      {
        kind: 'security',
        title: 'Secret committed',
        explanation: 'A hardcoded key was found',
        severity: 'high' as const,
        file_refs: ['src/a.ts:1'],
        file: 'src/a.ts',
        line: 1,
        endpoint: null,
        symbol: null,
        github_link: 'https://github.com/acme/api/blob/abc/src/a.ts#L1',
      },
    ];

    const db = makeFakeDb({ existingRow: null });
    const result = await upsertLlmBrief(db, PR_ID, makeLlmBrief(), enrichedRisks);

    expect(result.risks.risks).toEqual(enrichedRisks);
  });
});

describe('upsertLlmBrief — existing pr_brief row', () => {
  it('merges llm into the current brief and preserves deterministic fields', async () => {
    const current = makeDeterministicBrief({
      intent: { intent: 'Existing intent', in_scope: ['x'], out_of_scope: [] },
    });

    let updatedJson: unknown;
    const db = makeFakeDb({
      existingRow: { json: current },
      onUpdate: (values) => {
        updatedJson = values.json;
      },
    });

    const llm = makeLlmBrief();
    const result = await upsertLlmBrief(db, PR_ID, llm);

    expect(result).toMatchObject({
      intent: { intent: 'Existing intent' },
      llm,
    });
    expect(updatedJson).toEqual(result);
  });

  it('replaces risks.risks with enrichedRisks when provided, otherwise keeps current risks', async () => {
    const current = makeDeterministicBrief({
      risks: { risks: [{ kind: 'bug', title: 'N+1 query', explanation: '...', severity: 'medium', file_refs: [] }] },
    });
    const db = makeFakeDb({ existingRow: { json: current } });

    // No enrichedRisks passed — current risks preserved.
    const resultUnchanged = await upsertLlmBrief(db, PR_ID, makeLlmBrief());
    expect(resultUnchanged.risks).toEqual(current.risks);

    // enrichedRisks passed — replaces risks.risks entirely.
    const enriched = [
      { kind: 'security', title: 'New risk', explanation: '...', severity: 'high' as const, file_refs: [] },
    ];
    const resultReplaced = await upsertLlmBrief(db, PR_ID, makeLlmBrief(), enriched);
    expect(resultReplaced.risks.risks).toEqual(enriched);
  });
});
