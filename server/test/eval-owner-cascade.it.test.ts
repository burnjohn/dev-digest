import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides } from './helpers/overrides.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * T22 (SPEC-03 AC-41) — deleting an agent or a skill also deletes every
 * `eval_cases` / `eval_run_batches` row it owns, in one operation, and the
 * delete routes report the deleted case count as an OPTIONAL field.
 *
 * The static ring-compliance checks below run unconditionally (no DB, no
 * Docker gate) — they read source text, not behaviour.
 */
describe('ring compliance (static, no DB)', () => {
  function read(relPath: string): string {
    return readFileSync(resolve(__dirname, relPath), 'utf-8');
  }

  /** Only the real import edges — a docblock explaining WHY something is
   * absent legitimately mentions the forbidden path in prose. */
  function importLines(src: string): string[] {
    return src.split('\n').filter((line) => /^\s*import\b/.test(line));
  }

  it('neither service.ts imports drizzle-orm or db/schema*, and neither module imports modules/evals/**', () => {
    for (const relPath of ['../src/modules/agents/service.ts', '../src/modules/skills/service.ts']) {
      const imports = importLines(read(relPath)).join('\n');
      expect(imports, relPath).not.toMatch(/from ['"]drizzle-orm/);
      expect(imports, relPath).not.toMatch(/db\/schema/);
      expect(imports, relPath).not.toMatch(/modules\/evals/);
    }
  });

  it('neither modules/agents/** nor modules/skills/** imports modules/evals/**, and the reverse', () => {
    for (const relPath of [
      '../src/modules/agents/repository.ts',
      '../src/modules/agents/service.ts',
      '../src/modules/agents/routes.ts',
      '../src/modules/skills/repository.ts',
      '../src/modules/skills/service.ts',
      '../src/modules/skills/routes.ts',
    ]) {
      expect(importLines(read(relPath)).join('\n'), relPath).not.toMatch(/modules\/evals/);
    }
    // And the reverse: evals never reaches into agents/skills' repository/service.
    const evalsImports = importLines(read('../src/modules/evals/repository.ts')).join('\n');
    expect(evalsImports).not.toMatch(/modules\/agents\/(repository|service)/);
    expect(evalsImports).not.toMatch(/modules\/skills\/(repository|service)/);
  });
});

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-owner-cascade] Docker not available — skipping integration tests.');
}

d('DELETE /agents/:id and DELETE /skills/:id — eval owner cascade (REQ-41)', () => {
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
      overrides: hermeticOverrides({ git: new MockGitClient() }),
    });
  }

  async function makeAgent(ws: string, name = `agent-${randomUUID()}`) {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'review this',
      })
      .returning();
    return row!;
  }

  async function makeSkill(ws: string, name = `skill-${randomUUID()}`) {
    const [row] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: ws,
        name,
        description: '',
        type: 'convention',
        source: 'manual',
        body: 'body',
      })
      .returning();
    return row!;
  }

  async function seedEvalData(ws: string, ownerKind: 'agent' | 'skill', ownerId: string, n: number) {
    const caseIds: string[] = [];
    for (let i = 0; i < n; i++) {
      const [row] = await pg.handle.db
        .insert(t.evalCases)
        .values({ workspaceId: ws, ownerKind, ownerId, name: `case-${i}-${randomUUID()}` })
        .returning();
      caseIds.push(row!.id);
    }
    const [batch] = await pg.handle.db
      .insert(t.evalRunBatches)
      .values({ workspaceId: ws, ownerKind, ownerId, ownerVersion: 1, status: 'succeeded' })
      .returning();
    return { caseIds, batchId: batch!.id };
  }

  async function countCases(ws: string, ownerKind: 'agent' | 'skill', ownerId: string) {
    const rows = await pg.handle.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, ws),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
    return rows.length;
  }

  async function countBatches(ws: string, ownerKind: 'agent' | 'skill', ownerId: string) {
    const rows = await pg.handle.db
      .select({ id: t.evalRunBatches.id })
      .from(t.evalRunBatches)
      .where(
        and(
          eq(t.evalRunBatches.workspaceId, ws),
          eq(t.evalRunBatches.ownerKind, ownerKind),
          eq(t.evalRunBatches.ownerId, ownerId),
        ),
      );
    return rows.length;
  }

  // ===========================================================================
  // Agents
  // ===========================================================================

  it('REQ-41 — deleting an agent removes every eval_cases and eval_run_batches row naming it, in one operation, and returns the deleted case count', async () => {
    const app = await makeApp();
    const agent = await makeAgent(workspaceId);
    await seedEvalData(workspaceId, 'agent', agent.id, 3);
    expect(await countCases(workspaceId, 'agent', agent.id)).toBe(3);
    expect(await countBatches(workspaceId, 'agent', agent.id)).toBe(1);

    const res = await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(3);

    expect(await countCases(workspaceId, 'agent', agent.id)).toBe(0);
    expect(await countBatches(workspaceId, 'agent', agent.id)).toBe(0);
    await app.close();
  });

  it('an agent with zero eval cases deletes normally and reports a count of 0', async () => {
    const app = await makeApp();
    const agent = await makeAgent(workspaceId);

    const res = await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, count: 0 });
    await app.close();
  });

  it('the existing { ok: true } body still parses on DELETE /agents/:id without the new field', async () => {
    const app = await makeApp();
    const agent = await makeAgent(workspaceId);

    const res = await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` });
    const body = res.json() as { ok: boolean; count?: number };
    // The pre-existing shape — { ok: boolean } — parses fine even though the
    // route now also sends `count`; no route declares `schema.response` here,
    // so nothing strips extra keys either.
    expect(() => {
      const parsed: { ok: boolean } = { ok: body.ok };
      if (typeof parsed.ok !== 'boolean') throw new Error('not a boolean');
    }).not.toThrow();
    expect(body.ok).toBe(true);
    await app.close();
  });

  it('deleting an agent in another workspace answers 404 and deletes nothing', async () => {
    const app = await makeApp();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-${randomUUID()}` })
      .returning();
    const foreignAgent = await makeAgent(otherWs!.id, 'foreign-agent');
    await seedEvalData(otherWs!.id, 'agent', foreignAgent.id, 2);

    const res = await app.inject({ method: 'DELETE', url: `/agents/${foreignAgent.id}` });
    expect(res.statusCode).toBe(404);

    // Nothing touched: the agent, its eval_cases and its eval_run_batches all survive.
    expect(await countCases(otherWs!.id, 'agent', foreignAgent.id)).toBe(2);
    expect(await countBatches(otherWs!.id, 'agent', foreignAgent.id)).toBe(1);
    const [stillThere] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, foreignAgent.id));
    expect(stillThere).toBeDefined();

    // Cleanup: this test seeds cross-workspace state the fixture didn't create.
    await pg.handle.db.delete(t.evalRunBatches).where(eq(t.evalRunBatches.ownerId, foreignAgent.id));
    await pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.ownerId, foreignAgent.id));
    await pg.handle.db.delete(t.agents).where(eq(t.agents.id, foreignAgent.id));
    await pg.handle.db.delete(t.workspaces).where(eq(t.workspaces.id, otherWs!.id));
    await app.close();
  });

  // ===========================================================================
  // Skills
  // ===========================================================================

  it('REQ-41 — deleting a skill does the same, through its own module\'s repository', async () => {
    const app = await makeApp();
    const skill = await makeSkill(workspaceId);
    await seedEvalData(workspaceId, 'skill', skill.id, 2);
    expect(await countCases(workspaceId, 'skill', skill.id)).toBe(2);
    expect(await countBatches(workspaceId, 'skill', skill.id)).toBe(1);

    const res = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(2);

    expect(await countCases(workspaceId, 'skill', skill.id)).toBe(0);
    expect(await countBatches(workspaceId, 'skill', skill.id)).toBe(0);
    await app.close();
  });

  it('a skill with zero eval cases deletes normally and reports a count of 0', async () => {
    const app = await makeApp();
    const skill = await makeSkill(workspaceId);

    const res = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, count: 0 });
    await app.close();
  });

  it('the count survives DELETE /skills/:id\'s response schema — the widened OkResponse keeps the field, not stripping it', async () => {
    const app = await makeApp();
    const skill = await makeSkill(workspaceId);
    await seedEvalData(workspaceId, 'skill', skill.id, 1);

    const res = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(res.statusCode).toBe(200);
    // `response: { 200: OkResponse }` is declared on this route (routes.ts) —
    // a Zod object strips unknown keys, so this only passes if OkResponse itself
    // was widened to include `count`.
    expect(res.json()).toHaveProperty('count', 1);
    await app.close();
  });

  it('the existing { ok: true } body still parses on DELETE /skills/:id without the new field', async () => {
    const app = await makeApp();
    const skill = await makeSkill(workspaceId);

    const res = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    const body = res.json() as { ok: boolean; count?: number };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(0);
    // The pre-existing shape parses fine on its own — a caller reading only
    // `ok` (the old contract) is unaffected by the new optional field.
    const preExisting: { ok: boolean } = { ok: body.ok };
    expect(preExisting.ok).toBe(true);
    await app.close();
  });

  it('deleting a skill in another workspace answers 404 and deletes nothing', async () => {
    const app = await makeApp();
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ws-skill-${randomUUID()}` })
      .returning();
    const foreignSkill = await makeSkill(otherWs!.id, 'foreign-skill');
    await seedEvalData(otherWs!.id, 'skill', foreignSkill.id, 4);

    const res = await app.inject({ method: 'DELETE', url: `/skills/${foreignSkill.id}` });
    expect(res.statusCode).toBe(404);

    expect(await countCases(otherWs!.id, 'skill', foreignSkill.id)).toBe(4);
    expect(await countBatches(otherWs!.id, 'skill', foreignSkill.id)).toBe(1);
    const [stillThere] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, foreignSkill.id));
    expect(stillThere).toBeDefined();

    // Cleanup: cross-workspace state this test seeded itself.
    await pg.handle.db.delete(t.evalRunBatches).where(eq(t.evalRunBatches.ownerId, foreignSkill.id));
    await pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.ownerId, foreignSkill.id));
    await pg.handle.db.delete(t.skills).where(eq(t.skills.id, foreignSkill.id));
    await pg.handle.db.delete(t.workspaces).where(eq(t.workspaces.id, otherWs!.id));
    await app.close();
  });
});
