import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * The skills module end-to-end: CRUD, the version/snapshot rule (only a BODY
 * change bumps), the `used_by` join, cross-workspace isolation, and the tenancy
 * gate on agent↔skill linking.
 */
d('/skills', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
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

  const createBody = { name: 'probe-skill', body: '# Probe\nOriginal body.', description: 'p' };

  it('POST creates the skill AND its v1 snapshot in one shot', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/skills', payload: createBody });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill.version).toBe(1);
    expect(skill.enabled).toBe(true);
    // The response schema is the DTO gate — the tenant id must not reach the wire.
    expect(skill).not.toHaveProperty('workspace_id');

    const versions = await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` });
    expect(versions.json()).toHaveLength(1);
    expect(versions.json()[0]).toMatchObject({ version: 1, body: createBody.body });

    await app.close();
  });

  it('derives the name from the first H1 when none is given', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { body: '# Derived Title\n\ntext' },
    });
    expect(res.json().name).toBe('derived-title');
    await app.close();
  });

  it('a BODY edit bumps the version and appends a snapshot', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const updated = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { body: '# Probe\nChanged body.' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]); // newest first
    await app.close();
  });

  it('a metadata-only edit does NOT bump the version', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    const renamed = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { name: 'renamed-probe', description: 'new', type: 'security' },
    });
    expect(renamed.json().version).toBe(1);
    expect(renamed.json().name).toBe('renamed-probe');

    const toggled = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { enabled: false },
    });
    expect(toggled.json().version).toBe(1);
    expect(toggled.json().enabled).toBe(false);

    const versions = (
      await app.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json();
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('resubmitting an identical body does not bump the version', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();
    const same = await app.inject({
      method: 'PUT',
      url: `/skills/${created.id}`,
      payload: { body: createBody.body },
    });
    expect(same.json().version).toBe(1);
    await app.close();
  });

  it('rejects a body over the cap with 422, not a 500', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { body: '# big\n' + 'a'.repeat(8_100) },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('DELETE removes it and a later GET 404s', async () => {
    const app = await makeApp();
    const created = (
      await app.inject({ method: 'POST', url: '/skills', payload: createBody })
    ).json();

    expect((await app.inject({ method: 'DELETE', url: `/skills/${created.id}` })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'GET', url: `/skills/${created.id}` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'DELETE', url: `/skills/${created.id}` })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('list reports used_by from agent_skills', async () => {
    const app = await makeApp();
    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();

    // The seed links all four skills to the Test Quality Reviewer.
    const seeded = list.find(
      (s: { name: string }) => s.name === 'uncovered-branch-gate',
    );
    expect(seeded.used_by).toBe(1);

    // A brand-new, unlinked skill must read 0 — not 1 from a bad count(*).
    const fresh = (
      await app.inject({ method: 'POST', url: '/skills', payload: { body: '# unlinked-probe' } })
    ).json();
    const list2 = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list2.find((s: { id: string }) => s.id === fresh.id).used_by).toBe(0);
    await app.close();
  });

  it('is workspace-scoped: another tenant’s skill is invisible and 404s', async () => {
    const app = await makeApp();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant' })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: otherWs!.id,
        name: 'foreign-skill',
        description: '',
        type: 'custom',
        source: 'manual',
        body: 'secret rules from another tenant',
        enabled: true,
        version: 1,
      })
      .returning();

    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.some((s: { id: string }) => s.id === foreign!.id)).toBe(false);
    expect((await app.inject({ method: 'GET', url: `/skills/${foreign!.id}` })).statusCode).toBe(
      404,
    );
    // A cross-tenant DELETE must not succeed either.
    expect(
      (await app.inject({ method: 'DELETE', url: `/skills/${foreign!.id}` })).statusCode,
    ).toBe(404);

    await app.close();
  });

  it('refuses to link a skill from another workspace (422, not a silent link)', async () => {
    const app = await makeApp();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-tenant-2' })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: otherWs!.id,
        name: 'foreign-skill-2',
        description: '',
        type: 'custom',
        source: 'manual',
        body: 'injected instructions',
        enabled: true,
        version: 1,
      })
      .returning();

    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Test Quality Reviewer')));

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_id: foreign!.id },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');

    // …and nothing was linked.
    const links = (
      await app.inject({ method: 'GET', url: `/agents/${agent!.id}/skills` })
    ).json();
    expect(links.some((l: { skill_id: string }) => l.skill_id === foreign!.id)).toBe(false);
    await app.close();
  });

  it('setSkills replaces the set, keeps order, and bumps the agent version', async () => {
    const app = await makeApp();
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));

    const all = (await app.inject({ method: 'GET', url: '/skills' })).json();
    const ids = all.slice(0, 3).map((s: { id: string }) => s.id);

    const before = agent!.version;
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_ids: [ids[2], ids[0], ids[1]] },
    });
    expect(res.statusCode).toBe(200);
    // Order is preserved exactly as posted — it is prompt order.
    expect(res.json().map((l: { skill_id: string }) => l.skill_id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);

    const [after] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.id, agent!.id));
    expect(after!.version).toBe(before + 1);

    // The bump must be snapshotted, with the ordered ids — that is the point.
    const [snapshot] = await pg.handle.db
      .select()
      .from(t.agentVersions)
      .where(
        and(
          eq(t.agentVersions.agentId, agent!.id),
          eq(t.agentVersions.version, after!.version),
        ),
      );
    expect((snapshot!.configJson as { skills: string[] }).skills).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);

    await app.close();
  });

  it('a bad id in skill_ids leaves the existing links intact (transactional)', async () => {
    const app = await makeApp();
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'General Reviewer')));

    const all = (await app.inject({ method: 'GET', url: '/skills' })).json();
    const good = all.slice(0, 2).map((s: { id: string }) => s.id);
    await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_ids: good },
    });

    const bad = await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_ids: [good[0], '00000000-0000-4000-8000-000000000000'] },
    });
    expect(bad.statusCode).toBe(422);

    // The pre-existing links survive — the old delete-then-insert wiped them.
    const links = (
      await app.inject({ method: 'GET', url: `/agents/${agent!.id}/skills` })
    ).json();
    expect(links.map((l: { skill_id: string }) => l.skill_id)).toEqual(good);
    await app.close();
  });

  it('linkSkill appends at max(order)+1, so orders never collide', async () => {
    const app = await makeApp();
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Performance Reviewer')));

    const all = (await app.inject({ method: 'GET', url: '/skills' })).json();
    const [a, b, c] = all.slice(0, 3).map((s: { id: string }) => s.id);

    // Link three (orders 0,1,2), unlink the middle, then append a fourth.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_ids: [a, b, c] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_ids: [a, c] },
    });

    const fresh = (
      await app.inject({ method: 'POST', url: '/skills', payload: { body: '# appended-probe' } })
    ).json();
    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent!.id}/skills`,
      payload: { skill_id: fresh.id },
    });

    const orders = res.json().map((l: { order: number }) => l.order);
    expect(new Set(orders).size).toBe(orders.length); // no duplicates
    await app.close();
  });
});
