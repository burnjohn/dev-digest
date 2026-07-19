import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { BlastRadius } from '@devdigest/shared';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';
import { eq } from 'drizzle-orm';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A stub RepoIntel exposing only getBlastRadius (the only method blast uses). */
function stubRepoIntel(result: BlastResult): RepoIntel {
  return { getBlastRadius: async () => result } as unknown as RepoIntel;
}

const DEMO_FACADE: BlastResult = {
  changedSymbols: [{ file: 'src/lib/shared.ts', name: 'helper', kind: 'function' }],
  callers: [
    { file: 'src/api/items.ts', symbol: 'listItems', viaSymbol: 'helper', line: 12, rank: 80 },
    { file: 'src/api/webhooks.ts', symbol: 'onHook', viaSymbol: 'helper', line: 45, rank: 60 },
  ],
  impactedEndpoints: [],
  factsByFile: {
    'src/api/items.ts': { endpoints: ['GET /api/public/items'], crons: [] },
    'src/api/webhooks.ts': { endpoints: ['POST /api/public/webhooks'], crons: [] },
  },
};

d('Blast Radius — GET /pulls/:id/blast (L04)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let llm: MockLLMProvider;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  let repoSeq = 0;
  async function seedPr(opts: { clone?: boolean; files?: string[] } = {}) {
    const name = `payments-api-blast-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name,
        fullName: `acme/${name}`,
        clonePath: opts.clone === false ? null : `/mock/clones/acme/${name}`,
      })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 800 + repoSeq,
        title: 'blast fixture',
        author: 'tester',
        branch: 'feat/x',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: (opts.files ?? []).length,
        status: 'needs_review',
      })
      .returning();
    for (const path of opts.files ?? []) {
      await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, path, additions: 1, deletions: 0 });
    }
    return pr!;
  }

  const app = (facade: BlastResult = DEMO_FACADE) => {
    llm = new MockLLMProvider('openrouter', { structured: {} });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { repoIntel: stubRepoIntel(facade), llm: { openrouter: llm } },
    });
  };
  const get = async (a: Awaited<ReturnType<typeof buildApp>>, prId: string): Promise<BlastRadius> =>
    (await a.inject({ method: 'GET', url: `/pulls/${prId}/blast` })).json();

  it('R.P0.1/R.P0.2 — facade-first: returns a BlastRadius derived from the mocked facade', async () => {
    const a = await app();
    const pr = await seedPr({ files: ['src/lib/shared.ts'] });
    const b = await get(a, pr.id);
    expect(b).toHaveProperty('changed_symbols');
    expect(b).toHaveProperty('downstream');
    expect(b).toHaveProperty('summary');
    expect(b.changed_symbols[0]!.name).toBe('helper');
    await a.close();
  });

  it('R.P1.2 — shared-helper PR → ≥2 callers & ≥1 endpoint (acceptance)', async () => {
    const a = await app();
    const pr = await seedPr({ files: ['src/lib/shared.ts'] });
    const b = await get(a, pr.id);
    const d0 = b.downstream[0]!;
    expect(d0.callers.length).toBeGreaterThanOrEqual(2);
    expect(d0.endpoints_affected.length).toBeGreaterThanOrEqual(1);
    await a.close();
  });

  it('N.P0.3 — NO LLM call (free feature): MockLLM.calls is empty', async () => {
    const a = await app();
    const pr = await seedPr({ files: ['src/lib/shared.ts'] });
    await get(a, pr.id);
    expect(llm.calls.length).toBe(0);
    await a.close();
  });

  it('R.P1.1 — unknown PR → 404', async () => {
    const a = await app();
    const res = await a.inject({ method: 'GET', url: '/pulls/00000000-0000-0000-0000-000000000000/blast' });
    expect(res.statusCode).toBe(404);
    await a.close();
  });

  it('D.P0.1 — repo not cloned → empty result + explanatory summary (not blank/500)', async () => {
    const a = await app();
    const pr = await seedPr({ clone: false, files: ['src/lib/shared.ts'] });
    const b = await get(a, pr.id);
    expect(b.changed_symbols).toEqual([]);
    expect(b.downstream).toEqual([]);
    expect(b.summary).toMatch(/not cloned/i);
    await a.close();
  });

  it('D.P0.2 — no changed files → empty result + explanatory summary', async () => {
    const a = await app();
    const pr = await seedPr({ files: [] });
    const b = await get(a, pr.id);
    expect(b.changed_symbols).toEqual([]);
    expect(b.summary).toMatch(/no changed files/i);
    await a.close();
  });
});
