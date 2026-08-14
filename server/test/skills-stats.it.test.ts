import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[skills-stats] Docker not available — skipping integration tests.');
}

/**
 * `GET /skills/:id/stats` — the numbers behind the Stats tab and the list-card
 * footer. specs/02-skill-detail-tabs.md is explicit that these are largely
 * NEW: before `run_skill_links`, there was no queryable record of which skills
 * were in which run at all. These tests assert against the persisted aggregate
 * rather than re-deriving it, because the arithmetic (nulls on empty
 * denominators, association vs. attribution) is exactly what is easy to get
 * subtly wrong.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const TWO_FINDINGS: Review = {
  verdict: 'request_changes',
  summary: 'Two issues found.',
  score: 40,
  findings: [
    {
      id: 'f-sec',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-bug',
      severity: 'WARNING',
      category: 'bug',
      title: 'Unresolved redisUrl reference',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      rationale: '`x` is not defined in this scope.',
      confidence: 0.7,
      kind: 'finding',
    },
  ],
};

const NO_FINDINGS: Review = { verdict: 'comment', summary: 'Clean.', score: 100, findings: [] };

const RUBRIC_BODY = '# Rubric\n\nCheck for hardcoded secrets.';

d('skill stats', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(review: Review = NO_FINDINGS) {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: review }) },
      },
    });
  }

  type App = Awaited<ReturnType<typeof makeApp>>;

  async function setupPr() {
    const db = pg.handle.db;
    const name = `payments-api-stats-${repoSeq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return pr!;
  }

  async function makeSkill(app: App, name: string, body: string = RUBRIC_BODY, enabled = true) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name, description: `Use when reviewing ${name}.`, type: 'rubric', body, enabled },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  async function makeAgent(app: App, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review the diff.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  /** Run one agent against a fresh PR; returns the persisted finding ids. */
  async function runAgent(app: App, agentId: string): Promise<string[]> {
    const pr = await setupPr();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(200);
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews, 'no review persisted for the run').toHaveLength(1);
    return reviews[0].findings.map((f: { id: string }) => f.id);
  }

  async function stats(app: App, skillId: string) {
    const res = await app.inject({ method: 'GET', url: `/skills/${skillId}/stats` });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('used_by_agents counts agents currently linking the skill', async () => {
    const app = await makeApp();
    const skill = await makeSkill(app, 'used-by-rubric');
    const first = await makeAgent(app, 'Used By A');
    const second = await makeAgent(app, 'Used By B');
    for (const agent of [first, second]) {
      await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/skills`,
        payload: { skill_ids: [skill.id] },
      });
    }

    expect((await stats(app, skill.id)).used_by_agents).toBe(2);
    await app.close();
  });

  it('runs_with_skill / pull_rate reflect real runs, and fall when the skill is disabled', async () => {
    const app = await makeApp();
    const skill = await makeSkill(app, 'pull-rate-rubric');
    const agent = await makeAgent(app, 'Pull Rate Agent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    await runAgent(app, agent.id);
    let s = await stats(app, skill.id);
    expect(s.runs_with_skill).toBe(1);
    expect(s.runs_total).toBe(1);
    expect(s.pull_rate).toBe(1);

    // Disabled globally — the link is untouched, but the skill stops reaching
    // any prompt, so it stops accumulating runs_with_skill.
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });
    await runAgent(app, agent.id);

    s = await stats(app, skill.id);
    expect(s.runs_with_skill).toBe(1); // unchanged
    expect(s.runs_total).toBe(2); // the agent still links it, so the run still counts
    expect(s.pull_rate).toBe(0.5);
    await app.close();
  });

  it('accept_rate and findings_by_category are association, computed over runs that had the skill in the prompt', async () => {
    const app = await makeApp(TWO_FINDINGS);
    const skill = await makeSkill(app, 'accept-rate-rubric');
    const agent = await makeAgent(app, 'Accept Rate Agent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const findingIds = await runAgent(app, agent.id);
    expect(findingIds).toHaveLength(2);
    await app.inject({ method: 'POST', url: `/findings/${findingIds[0]}/accept` });
    await app.inject({ method: 'POST', url: `/findings/${findingIds[1]}/dismiss` });

    const s = await stats(app, skill.id);
    expect(s.findings_total).toBe(2);
    expect(s.accepted).toBe(1);
    expect(s.dismissed).toBe(1);
    expect(s.pending).toBe(0);
    expect(s.accept_rate).toBe(0.5);
    expect(
      [...s.findings_by_category].sort((a: { category: string }, b: { category: string }) =>
        a.category.localeCompare(b.category),
      ),
    ).toEqual([
      { category: 'bug', count: 1 },
      { category: 'security', count: 1 },
    ]);
    await app.close();
  });

  it('a skill with no runs reports zeros and nulls, never NaN', async () => {
    const app = await makeApp();
    const skill = await makeSkill(app, 'idle-rubric');

    expect(await stats(app, skill.id)).toMatchObject({
      used_by_agents: 0,
      runs_with_skill: 0,
      runs_total: 0,
      pull_rate: null,
      findings_total: 0,
      accepted: 0,
      dismissed: 0,
      pending: 0,
      accept_rate: null,
      findings_by_category: [],
    });
    await app.close();
  });

  it('404s on stats for an unknown skill, and on a non-uuid id 422s', async () => {
    const app = await makeApp();
    const missing = await app.inject({
      method: 'GET',
      url: '/skills/00000000-0000-0000-0000-000000000000/stats',
    });
    expect(missing.statusCode).toBe(404);

    const malformed = await app.inject({ method: 'GET', url: '/skills/not-a-uuid/stats' });
    expect(malformed.statusCode).toBe(422);
    await app.close();
  });

  it('the skills list carries the same usage numbers as the detail endpoint', async () => {
    const app = await makeApp();
    const skill = await makeSkill(app, 'list-footer-rubric');
    const agent = await makeAgent(app, 'List Footer Agent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    await runAgent(app, agent.id);

    const detail = await stats(app, skill.id);
    const list = (await app.inject({ method: 'GET', url: '/skills' })).json();
    const card = list.find((sk: { id: string }) => sk.id === skill.id);
    expect(card.used_by_agents).toBe(detail.used_by_agents);
    expect(card.pull_rate).toBe(detail.pull_rate);
    expect(card.accept_rate).toBe(detail.accept_rate);
    await app.close();
  });

  it('deleting a skill with run history cascades run_skill_links cleanly', async () => {
    const app = await makeApp();
    const skill = await makeSkill(app, 'deletable-rubric');
    const agent = await makeAgent(app, 'Deletable Agent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    await runAgent(app, agent.id);

    const del = await app.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(del.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: `/skills/${skill.id}/stats` });
    expect(after.statusCode).toBe(404);
    await app.close();
  });
});
