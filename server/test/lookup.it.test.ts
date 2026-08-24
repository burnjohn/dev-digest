/**
 * `GET /lookup/pull` — resolves human coordinates (`owner/name` + PR number)
 * to internal ids. Covers the hit, both miss cases with their candidate
 * lists, and asserts the read never calls GitHub and never writes — the
 * entire reason this module exists instead of reusing `GET /repos/:id/pulls`
 * (docs/plans/05-mcp-server.md §5.2).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import type { PullLookupResult } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `lookup-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

async function insertPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  repoId: string,
  number: number,
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
    })
    .returning();
  return pr!;
}

async function pullRequestCount(db: PgFixture['handle']['db']): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(t.pullRequests);
  return row!.count;
}

d('GET /lookup/pull (Testcontainers pg)', () => {
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

  it('resolves a known repo + PR with no GitHub call and no write', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);
    const pr = await insertPr(db, workspaceId, repo.id, 7);

    const gh = new MockGitHubClient();
    const listSpy = vi.spyOn(gh, 'listPullRequests');
    const getSpy = vi.spyOn(gh, 'getPullRequest');

    const before = await pullRequestCount(db);

    const app = await buildApp({ config: config(), db, overrides: { github: gh } });
    const res = await app.inject({
      method: 'GET',
      url: `/lookup/pull?repo=${encodeURIComponent(repo.fullName)}&number=${pr.number}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PullLookupResult;
    expect(body.ok).toBe(true);
    if (body.ok) {
      expect(body.pull).toEqual({
        repo_id: repo.id,
        pull_id: pr.id,
        number: 7,
        full_name: repo.fullName,
        head_sha: 'sha7',
        title: 'PR #7',
        status: 'open',
      });
    }

    expect(await pullRequestCount(db)).toBe(before);
    expect(listSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('returns repo_not_found with the imported repos as candidates', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);

    const app = await buildApp({ config: config(), db });
    const res = await app.inject({
      method: 'GET',
      url: `/lookup/pull?repo=${encodeURIComponent('nobody/ghost-repo')}&number=1`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PullLookupResult;
    expect(body.ok).toBe(false);
    if (!body.ok) {
      expect(body.reason).toBe('repo_not_found');
      expect(body.candidates).toContain(repo.fullName);
    }
  });

  it('returns pull_not_found with the repo\'s known PR numbers as candidates', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);
    await insertPr(db, workspaceId, repo.id, 3);

    const app = await buildApp({ config: config(), db });
    const res = await app.inject({
      method: 'GET',
      url: `/lookup/pull?repo=${encodeURIComponent(repo.fullName)}&number=99`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PullLookupResult;
    expect(body.ok).toBe(false);
    if (!body.ok) {
      expect(body.reason).toBe('pull_not_found');
      expect(body.candidates).toEqual(['3']);
    }
  });
});
