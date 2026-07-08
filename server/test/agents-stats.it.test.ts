import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import type { AgentCardStats } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-stats] Docker not available — skipping integration tests.');
}

/**
 * GET /agents/stats — per-agent usage rollup shown on the Agents list card
 * footer. Covers: runs + avg cost from `agent_runs`, accept rate over
 * accepted+dismissed findings of the agent's reviews, linked-skill count, and
 * the null/zero shape for an agent that has never run.
 */
d('GET /agents/stats', () => {
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

  async function defaultWorkspaceId(): Promise<string> {
    const [ws] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    return ws!.id;
  }

  it('aggregates runs, avg cost, accept rate and skill count for an agent', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const workspaceId = await defaultWorkspaceId();

    const agentId = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Stats Agent', provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'x' },
      })
    ).json().id as string;

    // Two runs → avg cost = (0.02 + 0.06) / 2 = 0.04.
    await db.insert(t.agentRuns).values([
      { workspaceId, agentId, status: 'done', costUsd: 0.02 },
      { workspaceId, agentId, status: 'done', costUsd: 0.06 },
    ]);

    // A review by this agent with 3 accepted + 1 dismissed finding → 75% accept.
    const [pr] = await db.select({ id: t.pullRequests.id }).from(t.pullRequests).limit(1);
    const [review] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId, kind: 'review' })
      .returning({ id: t.reviews.id });
    const base = {
      reviewId: review!.id,
      file: 'src/x.ts',
      startLine: 1,
      endLine: 1,
      severity: 'WARNING',
      category: 'correctness',
      title: 't',
      rationale: 'r',
      confidence: 0.9,
    };
    await db.insert(t.findings).values([
      { ...base, acceptedAt: new Date() },
      { ...base, acceptedAt: new Date() },
      { ...base, acceptedAt: new Date() },
      { ...base, dismissedAt: new Date() },
    ]);

    const res = await app.inject({ method: 'GET', url: '/agents/stats' });
    expect(res.statusCode).toBe(200);
    const stats = res.json() as AgentCardStats[];
    const mine = stats.find((s) => s.agent_id === agentId)!;
    expect(mine.runs).toBe(2);
    expect(mine.avg_cost_usd).toBeCloseTo(0.04, 5);
    expect(mine.accept_pct).toBe(75);
    expect(mine.skill_count).toBe(0);
    await app.close();
  });

  it('reports zero runs and null averages for an agent that never ran', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Idle Agent', provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'x' },
      })
    ).json().id as string;

    const stats = (await app.inject({ method: 'GET', url: '/agents/stats' })).json() as AgentCardStats[];
    const mine = stats.find((s) => s.agent_id === agentId)!;
    expect(mine.runs).toBe(0);
    expect(mine.accept_pct).toBeNull();
    expect(mine.avg_cost_usd).toBeNull();
    await app.close();
  });
});
