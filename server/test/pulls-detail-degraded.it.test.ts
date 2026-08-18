/**
 * GET /pulls/:id under a degraded GitHub.
 *
 * The route refreshes PR detail from GitHub and mirrors the result into
 * `pr_files` / `pr_commits`, which double as the offline cache. GitHub's PR
 * object and its files/commits sub-resources fail INDEPENDENTLY (the 2026-08-17
 * incident: `pulls.get` 200 while `pulls/:n/files` 404'd or answered `200 []`),
 * so the mirror has to distinguish "this PR has no files" from "we couldn't see
 * the files" — otherwise one bad reply wipes the cache for good.
 *
 * Needs Postgres to hold the cache being protected, hence the `.it` lane.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrDetail, RepoRef } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A client whose getPullRequest rejects the way Octokit does, with a status. */
class FailingGitHubClient extends MockGitHubClient {
  constructor(private readonly status: number) {
    super();
  }
  override async getPullRequest(_repo: RepoRef, _n: number): Promise<PrDetail> {
    throw Object.assign(new Error(`HttpError ${this.status}`), { status: this.status });
  }
}

const CACHED_FILES = [
  { path: 'src/a.ts', additions: 6, deletions: 1, patch: '@@ -1,2 +1,7 @@\n+const a = 1;' },
  { path: 'src/b.ts', additions: 4, deletions: 0, patch: '@@ -1,1 +1,5 @@\n+const b = 2;' },
];

let repoSeq = 0;

d('GET /pulls/:id under a degraded GitHub (Testcontainers pg)', () => {
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

  /** A PR whose diff is already cached locally, as a previously-successful fetch left it. */
  async function seedPrWithCachedDiff(opts: { withFiles?: boolean } = {}) {
    const withFiles = opts.withFiles ?? true;
    const name = `degraded-${repoSeq++}`;
    const db = pg.handle.db;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 7,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'deadbeef',
        additions: 10,
        deletions: 1,
        filesCount: withFiles ? 2 : 0,
        status: 'open',
      })
      .returning();
    if (withFiles) {
      await db.insert(t.prFiles).values(CACHED_FILES.map((f) => ({ prId: pr!.id, ...f })));
      await db.insert(t.prCommits).values({
        prId: pr!.id,
        sha: 'deadbeef',
        message: 'Add limiter',
        author: 'marisa.koch',
      });
    }
    return pr!;
  }

  const countFiles = (prId: string) =>
    pg.handle.db
      .select()
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId))
      .then((r) => r.length);

  it('keeps the cached diff when GitHub reports changed files but returns none', async () => {
    const pr = await seedPrWithCachedDiff();
    // The exact incident payload: the PR object is fine, the sub-resources are not.
    const gh = new MockGitHubClient({ detail: { files_count: 4, files: [], commits: [] } });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PrDetail;
    // This is the regression that mattered: on the old code the unconditional
    // delete ran and the guarded insert did not, permanently dropping both rows.
    expect(await countFiles(pr.id)).toBe(2);
    expect(body.files).toHaveLength(2);
    expect(body.files[0]!.patch).toContain('const a = 1;');
    expect(body.diff_source).toBe('cache');
    expect(body.diff_source_reason).toBe('unavailable');
  });

  it('still backfills the stats from the PR object, which did not fail', async () => {
    const pr = await seedPrWithCachedDiff();
    const gh = new MockGitHubClient({
      detail: { files_count: 4, additions: 26, deletions: 38, files: [], commits: [] },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    const body = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}` })).json() as PrDetail;

    // additions/deletions/files_count come from `pulls.get` — the call that worked.
    expect(body.files_count).toBe(4);
    expect(body.additions).toBe(26);
    expect(body.deletions).toBe(38);
  });

  it('reports unavailable when the cache is empty too', async () => {
    const pr = await seedPrWithCachedDiff({ withFiles: false });
    const gh = new MockGitHubClient({ detail: { files_count: 4, files: [], commits: [] } });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    const body = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}` })).json() as PrDetail;

    expect(body.files).toHaveLength(0);
    // Not 'cache': there is nothing cached, so the empty list carries no meaning.
    expect(body.diff_source).toBe('unavailable');
  });

  it('clears the cache for a PR that genuinely dropped to zero files', async () => {
    const pr = await seedPrWithCachedDiff();
    // files_count 0 AND files [] agree with each other — a trustworthy payload.
    const gh = new MockGitHubClient({
      detail: {
        files_count: 0,
        files: [],
        commits: [{ sha: 'c1', message: 'revert', author: 'x', committed_at: null }],
      },
    });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    const body = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}` })).json() as PrDetail;

    expect(await countFiles(pr.id)).toBe(0);
    expect(body.diff_source).toBe('github');
  });

  it('replaces the cache and reports a live source on a healthy fetch', async () => {
    const pr = await seedPrWithCachedDiff();
    const gh = new MockGitHubClient(); // default fixture: 1 file, 1 commit
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    const body = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}` })).json() as PrDetail;

    expect(await countFiles(pr.id)).toBe(1);
    expect(body.files[0]!.path).toBe('src/config.ts');
    expect(body.diff_source).toBe('github');
    expect(body.diff_source_reason).toBeNull();
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'unavailable'],
    [503, 'unavailable'],
  ])('classifies a %i as %s so a bad token is not read as an outage', async (status, reason) => {
    const pr = await seedPrWithCachedDiff();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new FailingGitHubClient(status as number) },
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}` });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PrDetail;
    expect(await countFiles(pr.id)).toBe(2);
    expect(body.diff_source).toBe('cache');
    expect(body.diff_source_reason).toBe(reason);
  });
});
