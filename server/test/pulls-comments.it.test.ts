/**
 * Inline PR review comments (Files changed tab) — GET/POST /pulls/:id/comments.
 * These proxy live to GitHub, so we drive them through a MockGitHubClient and
 * assert the route resolves the PR, reflects existing comments, and pins new
 * comments to the PR's head sha. Gated on Docker (needs Postgres to resolve the
 * PR + repo rows), matching the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrReviewComment } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `commented-${repoSeq++}`;
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
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

const EXISTING: PrReviewComment = {
  id: 1,
  path: 'src/config.ts',
  line: 11,
  original_line: 11,
  side: 'RIGHT',
  body: 'Why hardcode this key?',
  user: 'reviewer',
  created_at: '2026-06-01T00:00:00Z',
  html_url: 'https://github.com/acme/x/pull/7#discussion_r1',
  in_reply_to_id: null,
  is_outdated: false,
};

d('inline PR comments routes (Testcontainers pg)', () => {
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

  it('GET reflects existing GitHub review comments', async () => {
    const gh = new MockGitHubClient({ comments: [EXISTING] });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/comments` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrReviewComment[];
    expect(body).toHaveLength(1);
    expect(body[0]!.body).toBe('Why hardcode this key?');
  });

  it('POST creates a comment pinned to the PR head sha', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: { path: 'src/config.ts', line: 11, body: 'Please move this to an env var.' },
    });
    expect(res.statusCode).toBe(200);
    expect(gh.createdComments).toHaveLength(1);
    expect(gh.createdComments[0]).toMatchObject({
      commitId: 'deadbeef',
      path: 'src/config.ts',
      line: 11,
      body: 'Please move this to an env var.',
    });
    const created = res.json() as PrReviewComment;
    expect(created.path).toBe('src/config.ts');
    expect(created.line).toBe(11);
  });

  it('POST forwards a reply as in_reply_to', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: { path: 'src/config.ts', line: 11, body: 'agreed', in_reply_to: 42 },
    });
    expect(res.statusCode).toBe(200);
    expect(gh.createdComments[0]).toMatchObject({ inReplyTo: 42 });
  });

  it('POST rejects an empty body as a validation error', async () => {
    const gh = new MockGitHubClient();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: { path: 'src/config.ts', line: 11, body: '' },
    });
    // Zod parse failure → the app's validation status (422), nothing posted.
    expect(res.statusCode).toBe(422);
    expect(gh.createdComments).toHaveLength(0);
  });

  it('POST on a repo with no token answers 422 token_missing, not a downgraded 400', async () => {
    // Deliberately NO `overrides.github`: an injected client wins over
    // resolution for ANY id (container.github() short-circuits on the
    // override before consulting githubTokenId at all), which would mask the
    // very branch under test. Without it, container.github(null) throws
    // MissingTokenError before any Octokit is constructed — the production
    // path, and still hermetic since no network call is reachable.
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/comments`,
      payload: { path: 'src/config.ts', line: 11, body: 'Please move this to an env var.' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('token_missing');
  });
});
