/**
 * GET /repos/:id/pulls/number/:number — PR detail addressed by repo + PR
 * number (contract agreed with the client). Same response shape as
 * GET /pulls/:id, workspace-scoped, 404 when the repo or PR is unknown.
 *
 * Built WITHOUT a github override: the repo has no token, so the route serves
 * the persisted files/commits/body (the offline fallback path) — hermetic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { AuthProvider } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function authFor(workspaceId: string, userId: string): AuthProvider {
  return {
    currentUser: async () => ({ id: userId, email: 'b@example.com', name: 'B' }),
    currentWorkspace: async () => ({ id: workspaceId, name: 'ws-b' }),
  };
}

d('GET /repos/:id/pulls/number/:number (Testcontainers pg)', () => {
  let pg: PgFixture;
  let appA: Awaited<ReturnType<typeof buildApp>>;
  let appB: Awaited<ReturnType<typeof buildApp>>;
  let repoId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces);
    const [user] = await db.select().from(t.users);
    const [wsB] = await db.insert(t.workspaces).values({ name: 'ws-b-number' }).returning();

    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'by-number', fullName: 'acme/by-number' })
      .returning();
    repoId = repo!.id;
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws!.id,
        repoId,
        number: 42,
        title: 'addressed by number',
        author: 'a',
        branch: 'feat/n',
        base: 'main',
        headSha: 'cafebabe',
        additions: 3,
        deletions: 1,
        filesCount: 1,
        status: 'open',
        body: 'the body',
      })
      .returning();
    prId = pr!.id;
    await db.insert(t.prFiles).values({ prId, path: 'src/n.ts', additions: 3, deletions: 1, patch: '@@ -1 +1 @@' });
    await db.insert(t.prCommits).values({ prId, sha: 'cafebabe', message: 'm', author: 'a' });

    appA = await buildApp({ config: config(), db });
    appB = await buildApp({ config: config(), db, overrides: { auth: authFor(wsB!.id, user!.id) } });
  });

  afterAll(async () => {
    await appB?.close();
    await appA?.close();
    await pg?.stop();
  });

  it('returns the same body as GET /pulls/:id for the same PR', async () => {
    const byNumber = await appA.inject({
      method: 'GET',
      url: `/repos/${repoId}/pulls/number/42`,
    });
    expect(byNumber.statusCode).toBe(200);
    const byId = await appA.inject({ method: 'GET', url: `/pulls/${prId}` });
    expect(byId.statusCode).toBe(200);
    expect(byNumber.json()).toEqual(byId.json());
    expect(byNumber.json().files).toHaveLength(1);
    expect(byNumber.json().id).toBe(prId);
  });

  it('404s for a repo owned by another workspace', async () => {
    const res = await appB.inject({ method: 'GET', url: `/repos/${repoId}/pulls/number/42` });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown PR number', async () => {
    const res = await appA.inject({ method: 'GET', url: `/repos/${repoId}/pulls/number/999` });
    expect(res.statusCode).toBe(404);
  });

  it('422s for a non-positive-integer number', async () => {
    for (const bad of ['abc', '0', '-1', '1.5']) {
      const res = await appA.inject({ method: 'GET', url: `/repos/${repoId}/pulls/number/${bad}` });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }
  });
});
