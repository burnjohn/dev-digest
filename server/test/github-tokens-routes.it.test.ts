import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import type { FastifyInstance } from 'fastify';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('github-tokens routes', () => {
  let pg: PgFixture;
  let app: FastifyInstance;
  const stored: Record<string, string> = {};

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        github: new MockGitHubClient(),
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

  it('creates a token, stores the value out of band, and never returns it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/github-tokens',
      payload: { label: 'work', token: 'ghp_work' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.label).toBe('work');
    expect(body.configured).toBe(true);
    expect(JSON.stringify(body)).not.toContain('ghp_work');
    expect(stored[`GITHUB_TOKEN:${body.id}`]).toBe('ghp_work');
  });

  it('rejects a duplicate label with 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/github-tokens',
      payload: { label: 'work', token: 'ghp_other' },
    });
    expect(res.statusCode).toBe(422);
  });

  /**
   * The central safety property of this module: MockGitHubClient normally
   * always succeeds, so this uses its own app (built with a rejecting
   * MockGitHubClient and its own empty secrets store) to prove a rejected PAT
   * leaves NEITHER a row NOR a secret behind — not just a 422.
   */
  it('a rejected PAT leaves no row and no secret behind', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const rejectStored: Record<string, string> = {};
    const rejectApp = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        github: new MockGitHubClient({ rejectAuth: true }),
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
      const before = (await rejectApp.inject({ method: 'GET', url: '/github-tokens' })).json();

      const res = await rejectApp.inject({
        method: 'POST',
        url: '/github-tokens',
        payload: { label: 'bad-pat', token: 'ghp_bad' },
      });
      expect(res.statusCode).toBe(422);

      const after = (await rejectApp.inject({ method: 'GET', url: '/github-tokens' })).json();
      expect(after).toHaveLength(before.length);
      expect(Object.keys(rejectStored)).toHaveLength(0);
    } finally {
      await rejectApp.close();
    }
  });

  it('rejects an empty patch with 422', async () => {
    const [row] = (await app.inject({ method: 'GET', url: '/github-tokens' })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/github-tokens/${row.id}`,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it('lists tokens with repo_count', async () => {
    const res = await app.inject({ method: 'GET', url: '/github-tokens' });
    expect(res.statusCode).toBe(200);
    const rows = res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].repo_count).toBe(0);
    expect(rows[0].github_login).toBeTruthy();
  });

  it('patch with only a label leaves the stored secret untouched', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/github-tokens',
      payload: { label: 'patch-label-only', token: 'ghp_label_only' },
    });
    const { id } = created.json();
    const secretBefore = stored[`GITHUB_TOKEN:${id}`];

    const res = await app.inject({
      method: 'PATCH',
      url: `/github-tokens/${id}`,
      payload: { label: 'patch-label-only-renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().label).toBe('patch-label-only-renamed');
    expect(stored[`GITHUB_TOKEN:${id}`]).toBe(secretBefore);
  });

  it('patch with only a token preserves the existing label and refreshes lastValidatedAt', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/github-tokens',
      payload: { label: 'patch-token-only', token: 'ghp_token_only_v1' },
    });
    const { id, label, last_validated_at: firstValidatedAt } = created.json();

    // A strictly later timestamp needs the clock to actually move.
    await new Promise((r) => setTimeout(r, 5));
    const res = await app.inject({
      method: 'PATCH',
      url: `/github-tokens/${id}`,
      payload: { token: 'ghp_token_only_v2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().label).toBe(label);
    expect(stored[`GITHUB_TOKEN:${id}`]).toBe('ghp_token_only_v2');
    expect(new Date(res.json().last_validated_at).getTime()).toBeGreaterThan(
      new Date(firstValidatedAt).getTime(),
    );
  });

  it('replacing the value tombstones nothing and overwrites the secret', async () => {
    const [row] = (await app.inject({ method: 'GET', url: '/github-tokens' })).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/github-tokens/${row.id}`,
      payload: { label: 'work-renamed', token: 'ghp_rotated' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().label).toBe('work-renamed');
    expect(stored[`GITHUB_TOKEN:${row.id}`]).toBe('ghp_rotated');
  });

  it('deleting reports how many repos were orphaned and tombstones the value', async () => {
    const [row] = (await app.inject({ method: 'GET', url: '/github-tokens' })).json();
    const res = await app.inject({ method: 'DELETE', url: `/github-tokens/${row.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ deleted: row.id, orphaned_repos: 0 });
    expect(stored[`GITHUB_TOKEN:${row.id}`]).toBe('');
  });

  it('test endpoint validates without persisting anything', async () => {
    const before = Object.keys(stored).length;
    const res = await app.inject({
      method: 'POST',
      url: '/github-tokens/test',
      payload: { token: 'ghp_probe' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(Object.keys(stored)).toHaveLength(before);
  });
});
