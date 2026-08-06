import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { LocalSecretsProvider } from '../src/adapters/secrets/local.js';
import { RepoService } from '../src/modules/repos/service.js';
import type { FastifyInstance } from 'fastify';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const testConfig = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('repos ↔ github token', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  const stored: Record<string, string> = {};

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    app = await buildApp({
      config: testConfig(),
      db: pg.handle.db,
      overrides: {
        github: new MockGitHubClient(),
        git: new MockGitClient(),
        secrets: {
          async get(k: string) {
            return stored[k];
          },
          async set(k: string, v: string) {
            stored[k] = v;
          },
        },
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const newToken = async (label: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/github-tokens',
        payload: { label, token: `ghp_${label}` },
      })
    ).json();

  const repoNamed = async (fullName: string) => {
    const rows = (await app.inject({ method: 'GET', url: '/repos' })).json();
    return rows.find((r: { full_name: string }) => r.full_name === fullName);
  };

  it('POST /repos without github_token_id creates a repo in the broken state', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/no-token' },
    });
    expect([200, 201]).toContain(res.statusCode);
    expect(res.json().github_token_id ?? null).toBeNull();
  });

  it('POST /repos with a token id stores it', async () => {
    const token = await newToken('work');
    const res = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/api', github_token_id: token.id },
    });
    expect([200, 201]).toContain(res.statusCode);
    expect(res.json().github_token_id).toBe(token.id);
  });

  it('GET /repos returns the token label alongside the id', async () => {
    const api = await repoNamed('acme/api');
    expect(api.github_token_label).toBe('work');
    const none = await repoNamed('acme/no-token');
    expect(none.github_token_label).toBeNull();
  });

  /**
   * `github_token_configured` must distinguish "assigned to a token with a
   * stored value" from BOTH `github_token_id: null` AND "assigned to a token
   * with no stored value" (the seeded `demo` token's exact shape — see
   * server/db/seed.ts). All three states currently exist across this suite's
   * fixtures: `acme/api` (real value via `newToken`), `acme/no-token`
   * (nothing assigned), and the seeded `acme/payments-api` (assigned to
   * `demo`, which has no PAT).
   */
  it('github_token_configured is true only when the assigned token actually resolves', async () => {
    const api = await repoNamed('acme/api');
    expect(api.github_token_id).toBeTruthy();
    expect(api.github_token_configured).toBe(true);

    const none = await repoNamed('acme/no-token');
    expect(none.github_token_id).toBeNull();
    expect(none.github_token_configured).toBe(false);

    const demo = await repoNamed('acme/payments-api');
    expect(demo.github_token_id).toBeTruthy();
    expect(demo.github_token_label).toBe('demo');
    expect(demo.github_token_configured).toBe(false);
  });

  it('PATCH /repos/:id/github-token reassigns, and null clears', async () => {
    const other = await newToken('personal');
    const api = await repoNamed('acme/api');

    const assigned = await app.inject({
      method: 'PATCH',
      url: `/repos/${api.id}/github-token`,
      payload: { github_token_id: other.id },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().github_token_id).toBe(other.id);
    expect(assigned.json().github_token_label).toBe('personal');

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/repos/${api.id}/github-token`,
      payload: { github_token_id: null },
    });
    expect(cleared.json().github_token_id).toBeNull();
    expect(cleared.json().github_token_label).toBeNull();
  });

  it('POST /repos/:id/poll on a repo with no token answers 422 token_missing', async () => {
    // Deliberately NO `overrides.github`: an injected client wins over
    // resolution for ANY id (see container-github-cache.test.ts), which would
    // mask the very thing under test. Without it this is the production path —
    // `container.github(null)` throws MissingTokenError before any network
    // call is possible, so the test stays hermetic despite a real Octokit
    // never being built.
    const none = await repoNamed('acme/no-token');
    const bareApp = await buildApp({
      config: testConfig(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        secrets: {
          async get(k: string) {
            return stored[k];
          },
        },
      },
    });
    try {
      const res = await bareApp.inject({ method: 'POST', url: `/repos/${none.id}/poll` });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('token_missing');
    } finally {
      await bareApp.close();
    }
  });

  it('POST /repos/:id/test-access probes the repo’s OWN token, server-side', async () => {
    const token = await newToken('probe');
    const created = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/probe-me', github_token_id: token.id },
    });
    const repo = created.json();

    const ok = await app.inject({ method: 'POST', url: `/repos/${repo.id}/test-access` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ok).toBe(true);
    expect(ok.json().login).toBeTruthy();
    // The raw value is never echoed back to the browser.
    expect(ok.payload).not.toContain('ghp_probe');

    const none = await repoNamed('acme/no-token');
    const missing = await app.inject({ method: 'POST', url: `/repos/${none.id}/test-access` });
    expect(missing.statusCode).toBe(200);
    expect(missing.json().ok).toBe(false);
    expect(missing.json().login).toBeNull();
    expect(missing.json().message).toMatch(/token/i);
  });

  /**
   * Task 7's delete test asserts `orphaned_repos: 0` with no repo ever pointed
   * at the token, so it passes trivially. This is the real case.
   */
  it('deleting a token orphans its repos: counted, kept, and left with a NULL token', async () => {
    const token = await newToken('doomed');
    const created = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/orphan-me', github_token_id: token.id },
    });
    expect(created.json().github_token_id).toBe(token.id);

    const del = await app.inject({ method: 'DELETE', url: `/github-tokens/${token.id}` });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toMatchObject({ deleted: token.id, orphaned_repos: 1 });

    const after = await repoNamed('acme/orphan-me');
    expect(after).toBeTruthy();
    expect(after.github_token_id).toBeNull();
    expect(after.github_token_label).toBeNull();
  });

  /**
   * `add`'s existing-repo dedupe used to return the row unchanged whenever the
   * caller re-posted an already-tracked full name — even with a DIFFERENT
   * token id in the body, silently discarding the user's pick (Task 8 deferred
   * finding, closed in the final review pass).
   */
  it('re-adding an already-tracked repo with a NEW token id assigns it, rather than silently keeping the old one', async () => {
    const first = await newToken('re-add-first');
    const added = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/re-add-me', github_token_id: first.id },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().github_token_id).toBe(first.id);

    const second = await newToken('re-add-second');
    const readded = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/re-add-me', github_token_id: second.id },
    });
    expect(readded.statusCode).toBe(200); // not created — the dedupe path
    expect(readded.json().github_token_id).toBe(second.id);
    expect(readded.json().github_token_label).toBe('re-add-second');

    // Persisted, not just in the response.
    const persisted = await repoNamed('acme/re-add-me');
    expect(persisted.github_token_id).toBe(second.id);
  });

  it('POST /repos with a token that cannot read the repo answers 422 at add time', async () => {
    // Its own app: the shared MockGitHubClient always succeeds. `rejectAuth`
    // stays off so the token can still be CREATED — only repo access fails.
    const rejectStored: Record<string, string> = {};
    const rejectApp = await buildApp({
      config: testConfig(),
      db: pg.handle.db,
      overrides: {
        github: new MockGitHubClient({ rejectRepoAccess: true }),
        git: new MockGitClient(),
        secrets: {
          async get(k: string) {
            return rejectStored[k];
          },
          async set(k: string, v: string) {
            rejectStored[k] = v;
          },
        },
      },
    });
    try {
      const token = (
        await rejectApp.inject({
          method: 'POST',
          url: '/github-tokens',
          payload: { label: 'no-access', token: 'ghp_no_access' },
        })
      ).json();

      const res = await rejectApp.inject({
        method: 'POST',
        url: '/repos',
        payload: { url: 'https://github.com/acme/private-thing', github_token_id: token.id },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toMatch(/cannot read acme\/private-thing/);

      // Nothing was persisted for a repo that can never be cloned.
      const rows = (await rejectApp.inject({ method: 'GET', url: '/repos' })).json();
      expect(rows.some((r: { full_name: string }) => r.full_name === 'acme/private-thing')).toBe(
        false,
      );

      // The SAME guard on the reassign path. `add` and `assignToken` share
      // `probeToken`, but they are separate call sites: deleting the call from
      // one of them has to fail a test.
      const existing = await repoNamed('acme/no-token');
      const patched = await rejectApp.inject({
        method: 'PATCH',
        url: `/repos/${existing.id}/github-token`,
        payload: { github_token_id: token.id },
      });
      expect(patched.statusCode).toBe(422);
      expect(patched.json().error.message).toMatch(/cannot read acme\/no-token/);
      expect((await repoNamed('acme/no-token')).github_token_id).toBeNull();
    } finally {
      await rejectApp.close();
    }
  });

  /**
   * `resolveGitHubToken` maps `GITHUB_TOKEN:<id>` by id ALONE — it takes no Db
   * on purpose, because ownership is authorization and belongs in the service.
   * These are the only two paths where a token id arrives from an untrusted
   * request body, so they are the only two that need the check. The second
   * workspace's token has a real stored value here, so without the guard the
   * probe would succeed and the repo would clone with another tenant's PAT.
   */
  it('a token id belonging to another workspace is 404, not usable', async () => {
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant' })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.githubTokens)
      .values({ workspaceId: otherWs!.id, label: 'other-tenant-pat' })
      .returning();
    // Resolvable on purpose: only the ownership check can produce the 404.
    stored[`GITHUB_TOKEN:${foreign!.id}`] = 'ghp_other_tenant';

    const added = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/cross-tenant', github_token_id: foreign!.id },
    });
    expect(added.statusCode).toBe(404);
    expect(added.json().error.message).toBe('Token not found');
    expect(await repoNamed('acme/cross-tenant')).toBeUndefined();

    const target = await repoNamed('acme/no-token');
    const patched = await app.inject({
      method: 'PATCH',
      url: `/repos/${target.id}/github-token`,
      payload: { github_token_id: foreign!.id },
    });
    expect(patched.statusCode).toBe(404);
    expect(patched.json().error.message).toBe('Token not found');

    // No repo anywhere ended up pointing at the foreign token.
    const pointing = await pg.handle.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.githubTokenId, foreign!.id));
    expect(pointing).toEqual([]);
  });
});

/**
 * The clone job's token resolution, against the REAL LocalSecretsProvider with
 * a bare `GITHUB_TOKEN` in its env — the exact shape of the hole this task
 * closes. `get()`'s generic env passthrough still serves that key, so only the
 * absence of any lookup for it keeps it out of the clone URL.
 */
d('clone job token resolution', () => {
  let pg: PgFixture;
  let dir: string;
  let app: FastifyInstance;
  let git: MockGitClient;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    dir = await mkdtemp(join(tmpdir(), 'devdigest-clone-token-'));
    git = new MockGitClient();
    app = await buildApp({
      config: testConfig(),
      db: pg.handle.db,
      overrides: {
        github: new MockGitHubClient(),
        git,
        secrets: new LocalSecretsProvider(join(dir, 'secrets.json'), {
          GITHUB_TOKEN: 'ghp_env_leak',
        } as NodeJS.ProcessEnv),
      },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("authenticates the clone with the repo's own token, never the bare env one", async () => {
    const tokenRes = await app.inject({
      method: 'POST',
      url: '/github-tokens',
      payload: { label: 'cloner', token: 'ghp_repo_own' },
    });
    // Asserted directly, not inferred downstream: this is the ONLY test that
    // writes through the real LocalSecretsProvider, so it is the guard against
    // the detached-`secrets.set` bug (which surfaced as 502 "Failed to store
    // the token value"). Without this line a reintroduction fails several steps
    // later as a confusing null-vs-undefined mismatch.
    expect(tokenRes.statusCode).toBe(201);
    const token = tokenRes.json();
    expect(token.id).toBeTruthy();
    expect(token.configured).toBe(true);

    const added = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/with-token.git', github_token_id: token.id },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().github_token_id).toBe(token.id);
    await app.container.jobs.onIdle();

    const cloned = git.cloned.find((c) => c.repo.name === 'with-token');
    expect(cloned).toBeTruthy();
    expect(cloned!.url).toContain('ghp_repo_own');
    expect(cloned!.url).not.toContain('ghp_env_leak');
  });

  it('clones anonymously when no token is assigned — the env token is ignored', async () => {
    await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/public-thing.git' },
    });
    await app.container.jobs.onIdle();

    const cloned = git.cloned.find((c) => c.repo.name === 'public-thing');
    expect(cloned).toBeTruthy();
    // Public repos still work with no token — but with NO credentials at all.
    expect(cloned!.url).toBe('https://github.com/acme/public-thing.git');
    expect(cloned!.url).not.toContain('ghp_env_leak');
  });

  it('a failed anonymous clone names the missing token and leaks no URL credentials', async () => {
    const failing = new MockGitClient();
    failing.clone = async () => {
      throw new Error("fatal: unable to access 'https://github.com/acme/private-thing.git/'");
    };
    const failingApp = await buildApp({
      config: testConfig(),
      db: pg.handle.db,
      overrides: {
        github: new MockGitHubClient(),
        git: failing,
        secrets: new LocalSecretsProvider(join(dir, 'secrets.json'), {
          GITHUB_TOKEN: 'ghp_env_leak',
        } as NodeJS.ProcessEnv),
      },
    });
    try {
      const service = new RepoService(failingApp.container);
      const err = await service
        .runCloneJob({
          repoId: '00000000-0000-0000-0000-000000000000',
          owner: 'acme',
          name: 'private-thing',
          url: 'https://github.com/acme/private-thing.git',
          githubTokenId: null,
        })
        .then(
          () => null,
          (e: Error) => e,
        );
      expect(err).toBeTruthy();
      expect(err!.message).toMatch(/no usable GitHub token/i);
      expect(err!.message).not.toContain('ghp_');
      expect(err!.message).not.toMatch(/https:\/\/[^@\s]+@/);
    } finally {
      await failingApp.close();
    }
  });
});
