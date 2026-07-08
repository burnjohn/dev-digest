/**
 * Hermetic tests for `OnboardingRepository` — the DB-level workspace-scoping
 * guard (§4: `onboarding` has no `workspace_id` column of its own; every
 * query — read AND write — is scoped by joining through `repos`).
 *
 * A hand-rolled fake `Db` satisfies the exact Drizzle chain shapes
 * `OnboardingRepository` calls, mirroring `test/blast-routes.test.ts`'s
 * `makeDb` pattern. No Postgres, no Docker.
 */
import { describe, it, expect, vi } from 'vitest';
import { OnboardingRepository } from '../src/modules/onboarding/repository.js';
import type { Db } from '../src/db/client.js';

const WS_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_WS_ID = '99999999-9999-9999-9999-999999999999';
const REPO_ID = '33333333-3333-3333-3333-333333333333';

/**
 * Builds a fake db whose `.select()` answers either the `getTour` join query
 * or the `upsertTour` transaction's EXISTS-style select, and whose
 * `.transaction()` runs the callback against a `tx` with the same `.select`
 * plus `.insert().values().onConflictDoUpdate().returning()`.
 */
function makeFakeDb(opts: {
  tourRow?: Record<string, unknown> | null;
  repoOwnsRow?: Record<string, unknown> | null; // row returned by the ownership SELECT
  upsertedRow?: Record<string, unknown> | null;
}): Db {
  function selectChain(resolve: () => Record<string, unknown>[]) {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: (_n: number) => Promise.resolve(resolve()),
      then: (onF?: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onF, onR),
    };
    return chain;
  }

  const select = (_cols?: Record<string, unknown>) => {
    // getTour uses innerJoin; the ownership-check select in upsertTour does not.
    // Both funnel through this same factory — resolved value is picked per-test.
    return selectChain(() => {
      const row = 'tourRow' in opts ? opts.tourRow : null;
      return row ? [row] : [];
    });
  };

  const fakeDb = {
    select,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const ownsRow = 'repoOwnsRow' in opts ? opts.repoOwnsRow : { id: REPO_ID };
      const tx = {
        select: (_cols?: Record<string, unknown>) =>
          selectChain(() => (ownsRow ? [ownsRow] : [])),
        insert: (_table: unknown) => ({
          values: (_vals: unknown) => ({
            onConflictDoUpdate: (_conf: unknown) => ({
              returning: (_cols?: Record<string, unknown>) => {
                const row = 'upsertedRow' in opts ? opts.upsertedRow : { id: REPO_ID };
                return Promise.resolve(row ? [row] : []);
              },
            }),
          }),
        }),
      };
      return cb(tx);
    },
  };

  return fakeDb as unknown as Db;
}

const TOUR_ROW = {
  repoId: REPO_ID,
  json: { sections: [] },
  generatedAt: new Date('2026-07-03T00:00:00Z'),
  mode: 'full' as const,
  indexStatus: 'full' as const,
  degraded: false,
  degradedReason: null,
  llmCostCents: 10,
};

describe('OnboardingRepository.getTour — workspace scoping', () => {
  it('returns the row when it exists and the repo belongs to the workspace', async () => {
    const db = makeFakeDb({ tourRow: TOUR_ROW });
    const repo = new OnboardingRepository(db);
    const row = await repo.getTour(WS_ID, REPO_ID);
    expect(row).not.toBeNull();
    expect(row?.repoId).toBe(REPO_ID);
  });

  it('returns null when no tour has ever been generated / cross-workspace', async () => {
    const db = makeFakeDb({ tourRow: null });
    const repo = new OnboardingRepository(db);
    const row = await repo.getTour(OTHER_WS_ID, REPO_ID);
    expect(row).toBeNull();
  });
});

describe('OnboardingRepository.upsertTour — DB-level cross-workspace write guard', () => {
  it('writes zero rows and returns null when the repo does not belong to the workspace (EXISTS check fails)', async () => {
    // repoOwnsRow: null simulates the EXISTS(repos WHERE id=repoId AND
    // workspace_id=workspaceId) check finding nothing — i.e. the repo
    // belongs to a DIFFERENT workspace than the caller supplied.
    const db = makeFakeDb({ repoOwnsRow: null });
    const repo = new OnboardingRepository(db);

    const result = await repo.upsertTour(OTHER_WS_ID, REPO_ID, {
      json: { sections: [] },
      generatedAt: new Date(),
      mode: 'full',
      indexStatus: 'full',
      degraded: false,
      degradedReason: null,
      llmCostCents: null,
    });

    expect(result).toBeNull();
  });

  it('persists and returns the row when the repo belongs to the workspace', async () => {
    const db = makeFakeDb({ repoOwnsRow: { id: REPO_ID }, upsertedRow: TOUR_ROW });
    const repo = new OnboardingRepository(db);

    const result = await repo.upsertTour(WS_ID, REPO_ID, {
      json: { sections: [] },
      generatedAt: new Date('2026-07-03T00:00:00Z'),
      mode: 'full',
      indexStatus: 'full',
      degraded: false,
      degradedReason: null,
      llmCostCents: 10,
    });

    expect(result).not.toBeNull();
    expect(result?.repoId).toBe(REPO_ID);
  });

  it('the ownership check runs inside the SAME transaction as the write (mechanical guard, not caller discipline)', async () => {
    const txSpy = vi.fn();
    const db = {
      select: () => {
        throw new Error('top-level select should not be used by upsertTour');
      },
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        txSpy();
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({ limit: () => Promise.resolve([{ id: REPO_ID }]) }),
            }),
          }),
          insert: () => ({
            values: () => ({
              onConflictDoUpdate: () => ({
                returning: () => Promise.resolve([TOUR_ROW]),
              }),
            }),
          }),
        };
        return cb(tx);
      },
    } as unknown as Db;

    const repo = new OnboardingRepository(db);
    const result = await repo.upsertTour(WS_ID, REPO_ID, {
      json: {},
      generatedAt: new Date(),
      mode: 'full',
      indexStatus: 'full',
      degraded: false,
      degradedReason: null,
      llmCostCents: null,
    });

    expect(txSpy).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });
});

describe('OnboardingRepository.getRepoBasics', () => {
  it('returns owner/name/defaultBranch/clonePath/workspaceId', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  owner: 'acme',
                  name: 'api',
                  defaultBranch: 'main',
                  clonePath: '/clones/acme/api',
                  workspaceId: WS_ID,
                },
              ]),
          }),
        }),
      }),
    } as unknown as Db;
    const repo = new OnboardingRepository(db);
    const basics = await repo.getRepoBasics(REPO_ID);
    expect(basics).toEqual({
      owner: 'acme',
      name: 'api',
      defaultBranch: 'main',
      clonePath: '/clones/acme/api',
      workspaceId: WS_ID,
    });
  });

  it('returns null when the repo does not exist', async () => {
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
      }),
    } as unknown as Db;
    const repo = new OnboardingRepository(db);
    expect(await repo.getRepoBasics('nonexistent')).toBeNull();
  });
});
