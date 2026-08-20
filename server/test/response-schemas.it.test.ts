/**
 * Response contracts on the secret-adjacent modules (settings, github-tokens,
 * repos): every 200/201 body must parse with its @devdigest/shared contract.
 *
 * Includes the documented secrets-status bug: the handler's cast hid that the
 * JSON omitted the contract-required `github` field entirely. With per-repo
 * PATs, `github` now reports whether ANY stored token value resolves.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  SecretsStatus,
  Settings,
  ConnTestResult,
  GitHubToken,
  RepoWithToken,
  type SecretKey,
  type SecretsProvider,
} from '@devdigest/shared';
import { z } from 'zod';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function secretsWith(stored: Record<string, string>): SecretsProvider {
  return {
    async get(key: SecretKey) {
      return stored[key as string];
    },
    async set(key: SecretKey, value: string) {
      stored[key as string] = value;
    },
  };
}

d('response schemas — settings / github-tokens / repos (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({ config: config(), db: pg.handle.db, overrides: { secrets: secretsWith({}) } });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  it('GET /settings/secrets-status satisfies the SecretsStatus contract, github:false with no configured token', async () => {
    const res = await app.inject({ method: 'GET', url: '/settings/secrets-status' });
    expect(res.statusCode).toBe(200);
    const parsed = SecretsStatus.safeParse(res.json());
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    // Seed creates one 'demo' token WITHOUT a stored value → not configured.
    expect(res.json().github).toBe(false);
  });

  it('secrets-status reports github:true once a stored token value resolves', async () => {
    const [token] = await pg.handle.db
      .insert(t.githubTokens)
      .values({ workspaceId, label: 'resp-schema' })
      .returning();
    const appWithToken = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { secrets: secretsWith({ [`GITHUB_TOKEN:${token!.id}`]: 'ghp_x' }) },
    });
    try {
      const res = await appWithToken.inject({ method: 'GET', url: '/settings/secrets-status' });
      expect(res.statusCode).toBe(200);
      expect(res.json().github).toBe(true);
    } finally {
      await appWithToken.close();
    }
  });

  it('GET and PUT /settings bodies satisfy the Settings contract', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { theme: 'light', polling_interval_min: 7 },
    });
    expect(put.statusCode).toBe(200);
    expect(Settings.safeParse(put.json()).success).toBe(true);
    expect(put.json().theme).toBe('light');

    const get = await app.inject({ method: 'GET', url: '/settings' });
    expect(get.statusCode).toBe(200);
    expect(Settings.safeParse(get.json()).success).toBe(true);
    expect(get.json().polling_interval_min).toBe(7);
  });

  it('POST /settings/test-connection body satisfies ConnTestResult (no key configured)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'openai' },
    });
    expect(res.statusCode).toBe(200);
    const body = ConnTestResult.parse(res.json());
    expect(body.ok).toBe(false);
  });

  it('GET /github-tokens body satisfies GitHubToken[]', async () => {
    const res = await app.inject({ method: 'GET', url: '/github-tokens' });
    expect(res.statusCode).toBe(200);
    expect(z.array(GitHubToken).safeParse(res.json()).success).toBe(true);
  });

  it('GET /github-tokens serializes ONLY the contract-declared fields (secret-leak guard)', async () => {
    const res = await app.inject({ method: 'GET', url: '/github-tokens' });
    expect(res.statusCode).toBe(200);
    const contractKeys = Object.keys(GitHubToken.shape).sort();
    for (const item of res.json() as Record<string, unknown>[]) {
      expect(Object.keys(item).sort()).toEqual(contractKeys);
    }
  });

  it('GET /repos body satisfies RepoWithToken[]', async () => {
    const res = await app.inject({ method: 'GET', url: '/repos' });
    expect(res.statusCode).toBe(200);
    const parsed = z.array(RepoWithToken).safeParse(res.json());
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
  });
});
