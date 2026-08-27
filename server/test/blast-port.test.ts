import { describe, it, expect } from 'vitest';
import type { SecretsProvider, SecretKey } from '@devdigest/shared';
import type { Db } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import type { RepoIntel, IndexState } from '../src/modules/repo-intel/types.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockBlastProvider } from '../src/adapters/mocks.js';

/**
 * Hermetic coverage for `container.blast` (SPEC-02, T2) — the cross-module
 * seam onion §2 rule 2 requires so `modules/reviews`'s risk-brief service
 * can reach blast-radius without importing `modules/blast/**` directly.
 * No Docker, no Postgres: `.test.ts`, not `.it.test.ts`
 * (server/INSIGHTS.md 2026-08-09 / 2026-08-21 — never construct a real
 * provider here, and `overrides.secrets` closes both live-key channels).
 */

type Row = Record<string, unknown>;

function fakeDb(rowsByTable: Map<unknown, Row[]>): Db {
  const db = {
    select: (..._cols: unknown[]) => ({
      from: (table: unknown) => ({
        where: async () => rowsByTable.get(table) ?? [],
      }),
    }),
  };
  return db as unknown as Db;
}

function fakeRepoIntel(overrides: Partial<RepoIntel>): RepoIntel {
  const notStubbed =
    (name: string) =>
    (..._args: unknown[]) => {
      throw new Error(`fakeRepoIntel.${name} not stubbed for this test`);
    };
  return {
    indexRepo: notStubbed('indexRepo'),
    refreshIndex: notStubbed('refreshIndex'),
    getIndexState: notStubbed('getIndexState'),
    getBlastRadius: notStubbed('getBlastRadius'),
    getRepoMap: notStubbed('getRepoMap'),
    getFileRank: notStubbed('getFileRank'),
    getSymbolsInFiles: notStubbed('getSymbolsInFiles'),
    getCallerSignatures: notStubbed('getCallerSignatures'),
    getUnresolvedReferences: notStubbed('getUnresolvedReferences'),
    getConventionSamples: notStubbed('getConventionSamples'),
    getAllSymbolNames: notStubbed('getAllSymbolNames'),
    getTopFilesByRank: notStubbed('getTopFilesByRank'),
    getCriticalPaths: notStubbed('getCriticalPaths'),
    ...overrides,
  };
}

function baseIndexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'sha1',
    indexerVersion: 2,
    updatedAt: new Date('2026-08-24T00:00:00Z'),
    ...overrides,
  };
}

/** Throws if ever read — proves `deps.llm` (and therefore narration) was never invoked. */
class ThrowingSecrets implements SecretsProvider {
  async get(_key: SecretKey): Promise<string | undefined> {
    throw new Error('secrets.get must NOT be called — no narrationModel was passed to getBlastRadius');
  }
}

describe('container.blast — override injection (REQ-17)', () => {
  it('returns the injected ContainerOverrides.blast instance verbatim', () => {
    const mock = new MockBlastProvider();
    const container = new Container(loadConfig({}), fakeDb(new Map()), { blast: mock });
    expect(container.blast).toBe(mock);
  });

  it('MockBlastProvider resolves undefined by default — the "no pull found" answer', async () => {
    const mock = new MockBlastProvider();
    await expect(mock.getBlastRadius('ws-1', 'pr-1')).resolves.toBeUndefined();
    expect(mock.calls).toEqual([{ workspaceId: 'ws-1', prId: 'pr-1' }]);
  });

  it('MockBlastProvider can be configured to throw — the degraded path T6 needs', async () => {
    const mock = new MockBlastProvider({ error: new Error('blast unavailable') });
    await expect(mock.getBlastRadius('ws-1', 'pr-1')).rejects.toThrow('blast unavailable');
  });

  it('container.blast surfaces both the resolve-undefined and throw paths through the override', async () => {
    const resolving = new Container(loadConfig({}), fakeDb(new Map()), {
      blast: new MockBlastProvider(),
    });
    await expect(resolving.blast.getBlastRadius('ws-1', 'pr-1')).resolves.toBeUndefined();

    const throwing = new Container(loadConfig({}), fakeDb(new Map()), {
      blast: new MockBlastProvider({ error: new Error('boom') }),
    });
    await expect(throwing.blast.getBlastRadius('ws-1', 'pr-1')).rejects.toThrow('boom');
  });
});

describe('container.blast — default (lazy) construction, no override', () => {
  it('constructs BlastService({ db, repoIntel, llm }) and getBlastRadius needs only (workspaceId, prId) — narrative stays null, deps.llm never resolved', async () => {
    const db = fakeDb(
      new Map<unknown, Row[]>([
        [schema.pullRequests, [{ id: 'pr-1', repoId: 'repo-1', headSha: 'sha1' }]],
        [schema.prFiles, [{ path: 'src/a.ts' }]],
        [schema.fileFacts, []],
      ]),
    );
    const repoIntel = fakeRepoIntel({
      getBlastRadius: async () => ({
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: false,
      }),
      getIndexState: async () => baseIndexState(),
    });
    const container = new Container(loadConfig({}), db, {
      repoIntel,
      secrets: new ThrowingSecrets(),
    });

    // Same instance across accesses — the getter memoizes to `_blast`, exactly
    // like `repoIntel` / `contextDocs`.
    expect(container.blast).toBe(container.blast);

    const result = await container.blast.getBlastRadius('ws-1', 'pr-1');
    if (!result) throw new Error('expected a result');
    expect(result.narrative).toBeNull();
  });

  it('resolves undefined for an unknown PR — the route\'s 404 signal, reachable with no repoIntel/DB hit', async () => {
    const db = fakeDb(new Map());
    const repoIntel = fakeRepoIntel({});
    const container = new Container(loadConfig({}), db, {
      repoIntel,
      secrets: new ThrowingSecrets(),
    });
    await expect(container.blast.getBlastRadius('ws-1', 'missing-pr')).resolves.toBeUndefined();
  });
});
