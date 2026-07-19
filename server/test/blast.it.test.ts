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
  type SeedFile = string | { path: string; patch?: string };
  async function seedRepo() {
    const name = `payments-api-blast-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: `/mock/clones/acme/${name}` })
      .returning();
    return repo!;
  }
  async function seedPrIn(repoId: string, files: SeedFile[], clone = true) {
    if (!clone) await pg.handle.db.update(t.repos).set({ clonePath: null }).where(eq(t.repos.id, repoId));
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId, repoId, number: 800 + repoSeq++, title: 'blast fixture', author: 'tester',
        branch: 'feat/x', base: 'main', headSha: 'deadbeef', additions: 1, deletions: 0,
        filesCount: files.length, status: 'needs_review',
      })
      .returning();
    for (const f of files) {
      const path = typeof f === 'string' ? f : f.path;
      const patch = typeof f === 'string' ? null : (f.patch ?? null);
      await pg.handle.db.insert(t.prFiles).values({ prId: pr!.id, path, additions: 1, deletions: 0, patch });
    }
    return pr!;
  }
  async function seedPr(opts: { clone?: boolean; files?: SeedFile[] } = {}) {
    const repo = await seedRepo();
    return seedPrIn(repo.id, opts.files ?? [], opts.clone !== false);
  }
  async function seedReviewWithFinding(prId: string, file: string, severity: string) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, kind: 'review', verdict: 'request_changes', summary: 's', score: 20 })
      .returning();
    await pg.handle.db.insert(t.findings).values({
      reviewId: review!.id, file, startLine: 1, endLine: 1, severity, category: 'security',
      title: 'seed finding', rationale: 'r', confidence: 0.9,
    });
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

  it('E.P0.1 — enriched: declaring file + caller roles + may_throw derived from the diff', async () => {
    const a = await app();
    const pr = await seedPr({
      files: [{ path: 'src/lib/shared.ts', patch: '@@ -1 +1,2 @@\n+  throw new Error("boom");' }],
    });
    const b = await get(a, pr.id);
    const d = b.downstream[0]!;
    expect(d.file).toBe('src/lib/shared.ts');
    expect(d.may_throw).toBe(true); // +throw in the patch
    // both DEMO_FACADE callers reach an endpoint → business
    expect(d.callers.every((c) => c.role === 'business')).toBe(true);
    await a.close();
  });

  it('E.P0.3 — breaking: flags a signature change on an endpoint-reachable symbol', async () => {
    const a = await app(); // DEMO_FACADE: symbol `helper` reaches an endpoint
    const pr = await seedPr({
      files: [
        { path: 'src/lib/shared.ts', patch: '@@ -1 +1 @@\n-export function helper(a) {}\n+export function helper(a, b) {}' },
      ],
    });
    const b = await get(a, pr.id);
    const d = b.downstream[0]!;
    expect(d.breaking).toBe(true);
    expect(d.endpoints_affected.length).toBeGreaterThan(0); // → breaking-integration risk
    await a.close();
  });

  it('E.P0.2 — cross-references EXISTING agent findings onto the changed symbol', async () => {
    const a = await app();
    const pr = await seedPr({ files: ['src/lib/shared.ts'] });
    await seedReviewWithFinding(pr.id, 'src/lib/shared.ts', 'CRITICAL');
    const b = await get(a, pr.id);
    expect(b.findings_available).toBe(true);
    expect(b.downstream[0]!.finding_severity).toBe('CRITICAL'); // blocker on impacted code
    expect(b.downstream[0]!.finding_count).toBe(1);
    await a.close();
  });

  it('E.P1.1 — findings_available is false when no agent has reviewed yet', async () => {
    const a = await app();
    const pr = await seedPr({ files: ['src/lib/shared.ts'] });
    const b = await get(a, pr.id);
    expect(b.findings_available).toBe(false);
    expect(b.downstream[0]!.finding_severity).toBeNull();
    await a.close();
  });

  it('E.P1.2 — lists prior PRs in the SAME repo that touched the same file', async () => {
    const a = await app();
    const repo = await seedRepo();
    const prior = await seedPrIn(repo.id, ['src/lib/shared.ts']);
    const current = await seedPrIn(repo.id, ['src/lib/shared.ts']);
    const b = await get(a, current.id);
    expect(b.related_prs.map((p) => p.id)).toContain(prior.id);
    expect(b.related_prs.every((p) => p.id !== current.id)).toBe(true); // never itself
    await a.close();
  });

  it('E.P1.3 — surfaces changed symbols with no external callers as dead_symbols', async () => {
    // Facade: two changed symbols, only `used` has a caller → `orphan` is dead.
    const facade: BlastResult = {
      changedSymbols: [
        { file: 'src/lib/shared.ts', name: 'used', kind: 'function' },
        { file: 'src/lib/shared.ts', name: 'orphan', kind: 'function' },
      ],
      callers: [{ file: 'src/api/items.ts', symbol: 'listItems', viaSymbol: 'used', line: 12, rank: 80 }],
      impactedEndpoints: [],
      factsByFile: {},
    };
    const a = await app(facade);
    const pr = await seedPr({ files: ['src/lib/shared.ts'] });
    const b = await get(a, pr.id);
    expect(b.dead_symbols.map((s) => s.name)).toContain('orphan');
    expect(b.downstream.map((d) => d.symbol)).toEqual(['used']);
    await a.close();
  });
});
