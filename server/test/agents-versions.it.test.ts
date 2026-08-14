import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsService } from '../src/modules/agents/service.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import type { Container } from '../src/platform/container.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
   
  console.warn('[agents-versions] Docker not available — skipping integration tests.');
}

/**
 * Agent version history — the read path over `agent_versions` snapshots that
 * `POST/PUT /agents` already write. Covers: a fresh agent has v1, a config edit
 * appends v2 (newest-first), single-version fetch, and the 404s (unknown agent,
 * unknown version, cross-workspace).
 */
d('GET /agents/:id/versions', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const createBody = {
    name: 'Versioned Agent',
    provider: 'openai' as const,
    model: 'gpt-4o-mini',
    system_prompt: 'Review the diff.',
  };

  it('a new agent has exactly one version (v1) capturing its config', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/agents', payload: createBody });
    expect(created.statusCode).toBe(201);
    const agentId = created.json().id as string;

    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` });
    expect(res.statusCode).toBe(200);
    const versions = res.json();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      agent_id: agentId,
      version: 1,
      config: { provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review the diff.' },
    });
    expect(typeof versions[0].created_at).toBe('string');
    await app.close();
  });

  it('a config edit appends a new version; list is newest-first', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;

    // A config-affecting change (model) bumps the version → snapshot v2.
    const updated = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { model: 'gpt-4o' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);

    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })
    ).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0].config.model).toBe('gpt-4o');
    expect(versions[1].config.model).toBe('gpt-4o-mini');
    await app.close();
  });

  it('toggling enabled does NOT create a new version', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;

    await app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { enabled: false } });

    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })
    ).json();
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('GET /agents/:id/versions/:version returns one snapshot', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;
    await app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { model: 'gpt-4o' } });

    const v1 = await app.inject({ method: 'GET', url: `/agents/${agentId}/versions/1` });
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toMatchObject({ version: 1, config: { model: 'gpt-4o-mini' } });
    await app.close();
  });

  it('404s for an unknown agent and an unknown version', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;
    const ghost = '00000000-0000-0000-0000-000000000000';

    expect(
      (await app.inject({ method: 'GET', url: `/agents/${ghost}/versions` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${ghost}/versions/1` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${agentId}/versions/99` })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('a non-numeric :version is rejected at the edge (422, not 404)', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;
    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/versions/abc` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('versions are workspace-scoped: another tenant cannot read them', async () => {
    const { db } = pg.handle;
    // An agent that lives in a DIFFERENT workspace than the request context.
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    const repo = new AgentsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });

    const service = new AgentsService({ db } as unknown as Container);
    const [{ id: defaultWs }] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));

    // Owner can read; a different workspace is denied (undefined → 404 at route).
    expect(await service.listVersions(otherWs!.id, foreign.id)).toHaveLength(1);
    expect(await service.listVersions(defaultWs!, foreign.id)).toBeUndefined();
    expect(await service.getVersion(defaultWs!, foreign.id, 1)).toBeUndefined();
  });
});
