/**
 * `GET /pulls/:id/blast` — DB-backed integration test (docs/plans/06-blast-radius.md,
 * T7, REQ-21). Drives the real route through `buildApp` against a seeded index, using
 * the REAL `container.repoIntel` (a real `RepoIntelService` over real Postgres) — not
 * a fake. That is the whole reason this file exists alongside the hermetic
 * `blast.test.ts` / `blast-graph.test.ts`: it is the only place gap G1 (REQ-5) can be
 * proven, because it depends on how `repo-intel/service.ts::tryPersistentBlast` (line
 * ~377) actually reads `file_facts` — for CALLER files only, never the changed files
 * themselves — a behaviour a hand-written `BlastResult` fixture can't expose.
 *
 * Follows the `lookup.it.test.ts` / `smart-diff-api.it.test.ts` shape: `startPg()`,
 * `dockerAvailable()`, `const d = hasDocker ? describe : describe.skip`,
 * `hermeticOverrides()` so no test can reach a real LLM or GitHub (secrets have two
 * sources — server/INSIGHTS.md 2026-08-21). Every test seeds its own repo (unique
 * name via `repoSeq`), so `freshRepo()`'s workspace-scoping gap (server/INSIGHTS.md
 * 2026-08-17) never applies here — nothing this module writes is workspace-scoped.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides } from './helpers/overrides.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { BlastRadiusResponse } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

type Db = PgFixture['handle']['db'];

let repoSeq = 0;

async function setupRepo(db: Db, workspaceId: string) {
  const name = `blast-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

async function insertPr(
  db: Db,
  workspaceId: string,
  repoId: string,
  number: number,
  extra: Partial<{ updatedAt: Date }> = {},
) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number,
      title: `PR #${number}`,
      author: 'octocat',
      branch: `feat/${number}`,
      base: 'main',
      headSha: `sha${number}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
      ...extra,
    })
    .returning();
  return pr!;
}

async function insertPrFiles(db: Db, prId: string, paths: string[]) {
  await db.insert(t.prFiles).values(paths.map((path) => ({ prId, path })));
}

d('GET /pulls/:id/blast (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith() {
    return buildApp({ config: config(), db: pg.handle.db, overrides: hermeticOverrides() });
  }

  it(
    'cases 1+2 — ok status on a full index: symbols, rank-sorted+self-excluded callers, ' +
      "and G1's changed-file chip (REQ-1, REQ-3, REQ-5)",
    async () => {
      const db = pg.handle.db;
      const repo = await setupRepo(db, workspaceId);
      const pr = await insertPr(db, workspaceId, repo.id, 1);
      await insertPrFiles(db, pr.id, ['src/limiter.ts']);

      await db.insert(t.repoIndexState).values({
        repoId: repo.id,
        lastIndexedSha: pr.headSha,
        indexerVersion: 1,
        status: 'full',
        filesIndexed: 3,
        filesSkipped: 0,
      });

      await db.insert(t.symbols).values({
        repoId: repo.id,
        path: 'src/limiter.ts',
        name: 'rateLimit',
        kind: 'function',
        line: 1,
      });

      // `getResolvedCallers` INNER JOINs `file_rank` on the caller's `fromFile`
      // — every file a reference originates from needs a row here, including
      // the declaring file itself (used below to prove the self-exclusion).
      await db.insert(t.fileRank).values([
        { repoId: repo.id, filePath: 'src/limiter.ts', pagerank: 0.1, hotness: 0, rank: 0, percentile: 10 },
        { repoId: repo.id, filePath: 'src/api/routes.ts', pagerank: 0.5, hotness: 0, rank: 5, percentile: 50 },
        { repoId: repo.id, filePath: 'src/api/other.ts', pagerank: 0.9, hotness: 0, rank: 10, percentile: 90 },
      ]);

      await db.insert(t.references).values([
        // A reference to `rateLimit` FROM its own declaring file — REQ-3
        // requires this be excluded from `callers[]` even though the
        // persistent-index join would otherwise happily return it.
        {
          repoId: repo.id,
          fromPath: 'src/limiter.ts',
          toSymbol: 'rateLimit',
          declFile: 'src/limiter.ts',
          line: 99,
        },
        {
          repoId: repo.id,
          fromPath: 'src/api/routes.ts',
          toSymbol: 'rateLimit',
          declFile: 'src/limiter.ts',
          line: 42,
        },
        {
          repoId: repo.id,
          fromPath: 'src/api/other.ts',
          toSymbol: 'rateLimit',
          declFile: 'src/limiter.ts',
          line: 20,
        },
      ]);

      // G1 (REQ-5): an endpoint declared DIRECTLY in the changed file itself
      // — not in a caller file. `repo-intel`'s own `getBlastRadius` never
      // reads `file_facts` for the changed file (only for caller files), so
      // this chip can only appear because `blast/repository.ts::getFileFactsForFiles`
      // reads it independently.
      await db.insert(t.fileFacts).values({
        repoId: repo.id,
        filePath: 'src/limiter.ts',
        endpoints: ['POST /reset'],
        crons: [],
      });

      const app = await appWith();
      const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BlastRadiusResponse;

      expect(body.status).toBe('ok');
      expect(body.status_reason).toBe('');
      expect(body.symbols).toHaveLength(1);

      const symbol = body.symbols[0]!;
      expect(symbol.name).toBe('rateLimit');
      expect(symbol.file).toBe('src/limiter.ts');
      // Mutation this catches: dropping/inverting the `c.file !== sym.file`
      // exclusion in `blast/helpers.ts::buildBlastResponse`, or the
      // `b.rank - a.rank` sort — either would change this list.
      expect(symbol.callers.map((c) => c.file)).toEqual(['src/api/other.ts', 'src/api/routes.ts']);
      expect(symbol.caller_count).toBe(2);
      // Mutation this catches: `blast/repository.ts::getFileFactsForFiles`
      // reading caller files instead of (or in addition to omitting) the
      // changed files, or `helpers.ts` dropping the `chipsFromFacts(...)` merge.
      expect(symbol.chips).toContainEqual({
        label: 'POST /reset',
        kind: 'endpoint',
        file: 'src/limiter.ts',
      });

      expect(body.coverage.crons_available).toBe(true);
      expect(body.coverage.imports_available).toBe(false);
      expect(body.coverage.prior_prs_available).toBe(false);

      await app.close();
    },
  );

  it('case 3 — G2: no usable index row degrades the response, crons flagged unavailable, non-empty reason (REQ-7)', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);
    const pr = await insertPr(db, workspaceId, repo.id, 2);
    await insertPrFiles(db, pr.id, ['src/handler.ts']);
    // Deliberately no `repo_index_state` row and no `clonePath` on the repo —
    // this repo has never been indexed at all, so `getIndexState` synthesises
    // a degraded row and the ripgrep fallback also degrades (no clone to read).

    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusResponse;

    // Mutation this catches: `deriveStatus` in `blast/helpers.ts` reporting
    // 'ok'/'partial' for a synthesised no-data index state, or hardcoding
    // `crons_available: true` instead of `status !== 'degraded'`.
    expect(body.status).toBe('degraded');
    expect(body.coverage.crons_available).toBe(false);
    expect(body.status_reason.length).toBeGreaterThan(0);
    expect(body.status_reason.toLowerCase()).toContain('cron');
    // REQ-8: an empty array is never how "unknown" is signalled — the array
    // may still be empty, but `crons_available` (asserted above) is what carries it.
    expect(body.symbols).toEqual([]);

    await app.close();
  });

  it('case 4 — bounded reverse-import walk: B at depth 1, C at depth 2, D never appears (REQ-9)', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);
    const pr = await insertPr(db, workspaceId, repo.id, 3);
    await insertPrFiles(db, pr.id, ['src/changed.ts']);

    await db.insert(t.repoIndexState).values({
      repoId: repo.id,
      lastIndexedSha: pr.headSha,
      indexerVersion: 1,
      status: 'full',
      filesIndexed: 4,
      filesSkipped: 0,
    });

    // Reverse-import chain: changed <- b <- c <- d. The walk is bounded at
    // depth 2 (two sequential `getReverseEdges` calls), so B (depth 1) and C
    // (depth 2) must be reached, but D (depth 3) must never appear.
    await db.insert(t.fileEdges).values([
      { repoId: repo.id, fromFile: 'src/b.ts', toFile: 'src/changed.ts' },
      { repoId: repo.id, fromFile: 'src/c.ts', toFile: 'src/b.ts' },
      { repoId: repo.id, fromFile: 'src/d.ts', toFile: 'src/c.ts' },
    ]);
    await db.insert(t.fileFacts).values([
      { repoId: repo.id, filePath: 'src/b.ts', endpoints: ['GET /b'], crons: [] },
      { repoId: repo.id, filePath: 'src/c.ts', endpoints: [], crons: ['0 0 * * *'] },
    ]);

    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusResponse;

    expect(body.coverage.imports_available).toBe(true);

    const byFile = Object.fromEntries(body.file_impact.map((f) => [f.file, f]));
    // Mutation this catches: widening `REVERSE_WALK_MAX_DEPTH` past 2, or
    // `service.ts` issuing a third `getReverseEdges` call — either would put
    // 'src/d.ts' in `file_impact`.
    expect(byFile['src/b.ts']?.depth).toBe(1);
    expect(byFile['src/c.ts']?.depth).toBe(2);
    expect(body.file_impact.map((f) => f.file)).not.toContain('src/d.ts');
    expect(byFile['src/b.ts']?.chips).toContainEqual({ label: 'GET /b', kind: 'endpoint', file: 'src/b.ts' });
    expect(byFile['src/c.ts']?.chips).toContainEqual({ label: '0 0 * * *', kind: 'cron', file: 'src/c.ts' });

    await app.close();
  });

  it('case 5 — prior PRs: an overlapping PR appears with its overlap_count and number; the current PR and an unrelated PR do not (REQ-10)', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);
    const currentPr = await insertPr(db, workspaceId, repo.id, 10, {
      updatedAt: new Date('2026-08-20T00:00:00Z'),
    });
    await insertPrFiles(db, currentPr.id, ['src/shared.ts', 'src/only-current.ts']);

    const priorPr = await insertPr(db, workspaceId, repo.id, 9, {
      updatedAt: new Date('2026-08-15T00:00:00Z'),
    });
    await insertPrFiles(db, priorPr.id, ['src/shared.ts', 'src/only-prior.ts']);

    // A third PR of the SAME repo with no path overlap — must not appear,
    // proving `buildPriorPrs` drops zero-overlap PRs rather than emitting
    // an `overlap_count: 0` row.
    const unrelatedPr = await insertPr(db, workspaceId, repo.id, 8, {
      updatedAt: new Date('2026-08-10T00:00:00Z'),
    });
    await insertPrFiles(db, unrelatedPr.id, ['src/unrelated.ts']);

    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/pulls/${currentPr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusResponse;

    expect(body.coverage.prior_prs_available).toBe(true);
    // Mutation this catches: `getOtherPrsOfRepo` losing its
    // `ne(pullRequests.id, excludePrId)` filter (the current PR would leak
    // in), or `buildPriorPrs` losing its `files.size === 0` skip (the
    // unrelated PR would leak in as `overlap_count: 0`).
    expect(body.prior_prs).toHaveLength(1);
    expect(body.prior_prs[0]!.number).toBe(priorPr.number);
    expect(body.prior_prs[0]!.overlap_count).toBe(1);
    expect(body.prior_prs[0]!.overlapping_files).toEqual(['src/shared.ts']);
    expect(body.prior_prs.some((p) => p.number === currentPr.number)).toBe(false);
    expect(body.prior_prs.some((p) => p.number === unrelatedPr.number)).toBe(false);

    await app.close();
  });

  it('case 6 — a PR belonging to another workspace 404s', async () => {
    const db = pg.handle.db;
    const [otherWs] = await db
      .insert(t.workspaces)
      .values({ name: `blast-other-ws-${repoSeq++}` })
      .returning();
    const repo = await setupRepo(db, otherWs!.id);
    const pr = await insertPr(db, otherWs!.id, repo.id, 1);
    await insertPrFiles(db, pr.id, ['src/x.ts']);

    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    // Mutation this catches: `blast/repository.ts::getPr` dropping its
    // `eq(pullRequests.workspaceId, workspaceId)` filter — the PR would then
    // resolve regardless of which workspace made the request (200 instead of 404).
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  // ---------------------------------------------------------------------
  // Verification step 2 of `check-if-this-was-federated-fox.md` — D1/D2
  // caller-cap and attribution fixes, proven through the real route against
  // real Postgres (the SQL these fixes live in cannot be exercised by the
  // hermetic `blast.test.ts` / `repo-intel-blast-cap.test.ts` fakes).
  // ---------------------------------------------------------------------

  it('case 7 — D1: the caller cap is per changed symbol, not global across the whole PR', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);
    const pr = await insertPr(db, workspaceId, repo.id, 20);
    await insertPrFiles(db, pr.id, ['src/alpha.ts', 'src/beta.ts']);

    await db.insert(t.repoIndexState).values({
      repoId: repo.id,
      lastIndexedSha: pr.headSha,
      indexerVersion: 1,
      status: 'full',
      filesIndexed: 2,
      filesSkipped: 0,
    });

    await db.insert(t.symbols).values([
      { repoId: repo.id, path: 'src/alpha.ts', name: 'alphaFn', kind: 'function', line: 1 },
      { repoId: repo.id, path: 'src/beta.ts', name: 'betaFn', kind: 'function', line: 1 },
    ]);

    // 25 cross-file callers of alphaFn, all ranked HIGH (176-200), and 25
    // cross-file callers of betaFn, all ranked LOW (76-100) — under the OLD
    // global `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` bug, a flat rank-desc
    // sort across BOTH symbols' callers combined hands all 20 slots to
    // alphaFn's top callers and leaves betaFn with `callers: []`,
    // `caller_count: 0` — indistinguishable from "genuinely no callers",
    // exactly the failure mode measured on live data (plan D1).
    const alphaFiles = Array.from({ length: 25 }, (_, i) => `src/alpha-caller-${i}.ts`);
    const betaFiles = Array.from({ length: 25 }, (_, i) => `src/beta-caller-${i}.ts`);

    await db.insert(t.fileRank).values([
      ...alphaFiles.map((filePath, i) => ({
        repoId: repo.id,
        filePath,
        pagerank: 0.5,
        hotness: 0,
        rank: 200 - i,
        percentile: 90,
      })),
      ...betaFiles.map((filePath, i) => ({
        repoId: repo.id,
        filePath,
        pagerank: 0.5,
        hotness: 0,
        rank: 100 - i,
        percentile: 50,
      })),
    ]);

    await db.insert(t.references).values([
      ...alphaFiles.map((fromPath) => ({
        repoId: repo.id,
        fromPath,
        toSymbol: 'alphaFn',
        declFile: 'src/alpha.ts',
        line: 1,
      })),
      ...betaFiles.map((fromPath) => ({
        repoId: repo.id,
        fromPath,
        toSymbol: 'betaFn',
        declFile: 'src/beta.ts',
        line: 1,
      })),
    ]);

    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusResponse;

    const byName = Object.fromEntries(body.symbols.map((s) => [s.name, s]));
    // Mutation this catches: `repo-intel/service.ts::tryPersistentBlast`
    // reverting `callers: capBlastCallers(callers)` to the old flat
    // `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` — betaFn's callers/
    // caller_count would collapse to 0 while alphaFn keeps all 20.
    expect(byName['alphaFn']?.callers).toHaveLength(20);
    expect(byName['alphaFn']?.caller_count).toBe(20);
    expect(byName['betaFn']?.callers).toHaveLength(20);
    expect(byName['betaFn']?.caller_count).toBe(20);

    await app.close();
  });

  it('case 8 — D2: two symbols sharing a name are attributed callers by (name, declFile), not name alone', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);
    const pr = await insertPr(db, workspaceId, repo.id, 21);
    await insertPrFiles(db, pr.id, [
      'src/conventions/helpers.ts',
      'src/platform/pattern-safety.ts',
    ]);

    await db.insert(t.repoIndexState).values({
      repoId: repo.id,
      lastIndexedSha: pr.headSha,
      indexerVersion: 1,
      status: 'full',
      filesIndexed: 2,
      filesSkipped: 0,
    });

    // Same NAME declared in two different changed files — the live repro
    // (`compileSafeRegex` in `conventions/helpers.ts` AND
    // `platform/pattern-safety.ts`, both wrongly shown `mocks.ts:312` before
    // the fix).
    await db.insert(t.symbols).values([
      {
        repoId: repo.id,
        path: 'src/conventions/helpers.ts',
        name: 'compileSafeRegex',
        kind: 'function',
        line: 1,
      },
      {
        repoId: repo.id,
        path: 'src/platform/pattern-safety.ts',
        name: 'compileSafeRegex',
        kind: 'function',
        line: 1,
      },
    ]);

    await db.insert(t.fileRank).values([
      {
        repoId: repo.id,
        filePath: 'src/caller-of-conventions.ts',
        pagerank: 0.5,
        hotness: 0,
        rank: 10,
        percentile: 80,
      },
      {
        repoId: repo.id,
        filePath: 'src/caller-of-platform.ts',
        pagerank: 0.5,
        hotness: 0,
        rank: 5,
        percentile: 60,
      },
    ]);

    await db.insert(t.references).values([
      {
        repoId: repo.id,
        fromPath: 'src/caller-of-conventions.ts',
        toSymbol: 'compileSafeRegex',
        declFile: 'src/conventions/helpers.ts',
        line: 312,
      },
      {
        repoId: repo.id,
        fromPath: 'src/caller-of-platform.ts',
        toSymbol: 'compileSafeRegex',
        declFile: 'src/platform/pattern-safety.ts',
        line: 40,
      },
    ]);

    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusResponse;

    expect(body.symbols).toHaveLength(2);
    const conventionsSym = body.symbols.find((s) => s.file === 'src/conventions/helpers.ts')!;
    const platformSym = body.symbols.find((s) => s.file === 'src/platform/pattern-safety.ts')!;

    // Mutation this catches: dropping `declFile: c.declFile` from the
    // `BlastCallerRow` built in `repo-intel/service.ts::tryPersistentBlast`
    // — `blast/helpers.ts`'s attribution filter falls back to name-only
    // matching whenever `declFile` is `undefined`, so BOTH symbols would show
    // BOTH callers (the exact `mocks.ts:312` mis-attribution from live data).
    expect(conventionsSym.callers.map((c) => c.file)).toEqual(['src/caller-of-conventions.ts']);
    expect(conventionsSym.caller_count).toBe(1);
    expect(platformSym.callers.map((c) => c.file)).toEqual(['src/caller-of-platform.ts']);
    expect(platformSym.caller_count).toBe(1);

    await app.close();
  });

  it(
    'case 9 — same-file references are excluded in SQL, not only by the JS guard: ' +
      'a same-file ref must not consume a per-symbol cap slot',
    async () => {
      const db = pg.handle.db;
      const repo = await setupRepo(db, workspaceId);
      const pr = await insertPr(db, workspaceId, repo.id, 22);
      await insertPrFiles(db, pr.id, ['src/reused.ts']);

      await db.insert(t.repoIndexState).values({
        repoId: repo.id,
        lastIndexedSha: pr.headSha,
        indexerVersion: 1,
        status: 'full',
        filesIndexed: 1,
        filesSkipped: 0,
      });

      await db.insert(t.symbols).values({
        repoId: repo.id,
        path: 'src/reused.ts',
        name: 'reused',
        kind: 'function',
        line: 1,
      });

      // Exactly 20 legitimate cross-file callers (at the per-symbol cap
      // boundary) PLUS one same-file self-reference ranked ABOVE all of
      // them. `blast/helpers.ts`'s JS guard (`c.file !== sym.file`) excludes
      // the self-reference from the DISPLAYED `callers[]` array either way,
      // so just asserting its absence from `callers[]` would pass even if
      // SQL never excluded it. This case checks the side effect instead: if
      // SQL doesn't exclude it, the self-reference still wins a slot in
      // `repo-intel`'s per-symbol cap (20) BEFORE the JS guard ever runs,
      // displacing the lowest-rank legitimate caller and leaving only 19
      // legitimate callers once the self-reference is filtered out
      // downstream.
      const callerFiles = Array.from({ length: 20 }, (_, i) => `src/caller-${i}.ts`);
      await db.insert(t.fileRank).values([
        {
          repoId: repo.id,
          filePath: 'src/reused.ts',
          pagerank: 0.9,
          hotness: 0,
          rank: 1000,
          percentile: 99,
        },
        ...callerFiles.map((filePath, i) => ({
          repoId: repo.id,
          filePath,
          pagerank: 0.3,
          hotness: 0,
          rank: i + 1,
          percentile: 40,
        })),
      ]);

      await db.insert(t.references).values([
        // Same-file self-reference — ranked far above every legitimate caller.
        {
          repoId: repo.id,
          fromPath: 'src/reused.ts',
          toSymbol: 'reused',
          declFile: 'src/reused.ts',
          line: 99,
        },
        ...callerFiles.map((fromPath) => ({
          repoId: repo.id,
          fromPath,
          toSymbol: 'reused',
          declFile: 'src/reused.ts',
          line: 1,
        })),
      ]);

      const app = await appWith();
      const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BlastRadiusResponse;

      const symbol = body.symbols[0]!;
      // Mutation this catches: dropping
      // `ne(t.references.fromPath, t.references.declFile)` from
      // `repo-intel/repository.ts::getResolvedCallers`'s WHERE clause — the
      // self-reference would then win a cap slot by rank, dropping this to
      // 19/19 instead of 20/20, even though it never appears in `callers[]`.
      expect(symbol.callers).toHaveLength(20);
      expect(symbol.caller_count).toBe(20);
      expect(symbol.callers.some((c) => c.file === 'src/reused.ts')).toBe(false);

      await app.close();
    },
  );

  it('case 10 — symbols[] is ordered caller_count desc, then chips.length desc, then name asc', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);
    const pr = await insertPr(db, workspaceId, repo.id, 23);
    await insertPrFiles(db, pr.id, ['src/z.ts', 'src/a.ts', 'src/m.ts']);

    await db.insert(t.repoIndexState).values({
      repoId: repo.id,
      lastIndexedSha: pr.headSha,
      indexerVersion: 1,
      status: 'full',
      filesIndexed: 3,
      filesSkipped: 0,
    });

    // Three changed symbols with distinguishable caller counts, named so an
    // alphabetical-only or `changedSymbols`-insertion-order sort would NOT
    // already produce the expected sequence: `zFn` (0 callers) must sort
    // LAST despite being alphabetically first among these three, and
    // `aFn`/`mFn` (2 callers each — tied) must tie-break by name ascending.
    await db.insert(t.symbols).values([
      { repoId: repo.id, path: 'src/z.ts', name: 'zFn', kind: 'function', line: 1 },
      { repoId: repo.id, path: 'src/a.ts', name: 'aFn', kind: 'function', line: 1 },
      { repoId: repo.id, path: 'src/m.ts', name: 'mFn', kind: 'function', line: 1 },
    ]);

    await db.insert(t.fileRank).values([
      {
        repoId: repo.id,
        filePath: 'src/caller-a1.ts',
        pagerank: 0.4,
        hotness: 0,
        rank: 2,
        percentile: 60,
      },
      {
        repoId: repo.id,
        filePath: 'src/caller-a2.ts',
        pagerank: 0.4,
        hotness: 0,
        rank: 1,
        percentile: 60,
      },
      {
        repoId: repo.id,
        filePath: 'src/caller-m1.ts',
        pagerank: 0.4,
        hotness: 0,
        rank: 2,
        percentile: 60,
      },
      {
        repoId: repo.id,
        filePath: 'src/caller-m2.ts',
        pagerank: 0.4,
        hotness: 0,
        rank: 1,
        percentile: 60,
      },
    ]);

    await db.insert(t.references).values([
      { repoId: repo.id, fromPath: 'src/caller-a1.ts', toSymbol: 'aFn', declFile: 'src/a.ts', line: 1 },
      { repoId: repo.id, fromPath: 'src/caller-a2.ts', toSymbol: 'aFn', declFile: 'src/a.ts', line: 1 },
      { repoId: repo.id, fromPath: 'src/caller-m1.ts', toSymbol: 'mFn', declFile: 'src/m.ts', line: 1 },
      { repoId: repo.id, fromPath: 'src/caller-m2.ts', toSymbol: 'mFn', declFile: 'src/m.ts', line: 1 },
      // zFn: deliberately NO references at all -> 0 callers, 0 chips, must
      // sort last.
    ]);

    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as BlastRadiusResponse;

    // Mutation this catches: removing/inverting the `symbols.sort(...)` call
    // in `blast/helpers.ts::buildBlastResponse` — the array would instead
    // come back in `changedSymbols` (declaration/insertion) order
    // (zFn, aFn, mFn), not the usefulness order (aFn, mFn, zFn).
    expect(body.symbols.map((s) => s.name)).toEqual(['aFn', 'mFn', 'zFn']);
    const counts = body.symbols.map((s) => s.caller_count);
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]!);
    }

    await app.close();
  });
});
