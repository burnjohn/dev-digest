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
  console.warn('[skills-prompt] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'Nothing blocking.',
  score: 80,
  findings: [],
};

/**
 * What actually reaches the model.
 *
 * The whole point of the two switches (`agent_skills.enabled` and the skill's own
 * `enabled`) is that the assembled prompt changes. These tests assert on the
 * persisted run trace's `prompt_assembly.skills`, which is the same document the
 * trace drawer renders — so a passing test here means the UI shows it too.
 */
d('skills in the assembled prompt', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  async function setupPr() {
    const name = `skills-prompt-${prSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
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
        status: 'needs_review',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return pr!;
  }

  type App = Awaited<ReturnType<typeof makeApp>>;

  async function makeAgent(app: App, name: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name,
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'You are a reviewer.',
          // Off: repo-intel enrichment would add unrelated prompt sections.
          repo_intel: false,
        },
      })
    ).json();
  }

  async function makeSkill(app: App, name: string, body: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name, description: 'When X, do Y.', type: 'rubric', body },
      })
    ).json();
  }

  /** Run one agent over a PR and return the persisted trace's skills block. */
  async function skillsBlockFor(app: App, prId: string, agentId: string) {
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId } })
    ).json();
    await waitForPrRuns(pg.handle.db, prId, { expected: 1 });
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ url: `/runs/${runId}/trace` })).json();
    return trace.prompt_assembly.skills as string | null;
  }

  it('an agent with no skills produces no skills block at all', async () => {
    const app = await makeApp();
    const pr = await setupPr();
    const agent = await makeAgent(app, `No Skills ${Date.now()}`);

    expect(await skillsBlockFor(app, pr.id, agent.id)).toBeNull();
    await app.close();
  });

  it('injects enabled skills as named blocks, in link order', async () => {
    const app = await makeApp();
    const pr = await setupPr();
    const agent = await makeAgent(app, `Two Skills ${Date.now()}`);
    const first = await makeSkill(app, `alpha-${Date.now()}`, 'Alpha guidance.');
    const second = await makeSkill(app, `beta-${Date.now()}`, 'Beta guidance.');

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: {
        skills: [
          { skill_id: second.id, enabled: true },
          { skill_id: first.id, enabled: true },
        ],
      },
    });

    const block = await skillsBlockFor(app, pr.id, agent.id);
    expect(block).toContain(`### ${second.name}`);
    expect(block).toContain('Beta guidance.');
    expect(block).toContain(`### ${first.name}`);
    // Link order is prompt order: the second-created skill was linked first.
    expect(block!.indexOf(second.name)).toBeLessThan(block!.indexOf(first.name));
    await app.close();
  });

  it('leaves out a skill switched off for this agent', async () => {
    const app = await makeApp();
    const pr = await setupPr();
    const agent = await makeAgent(app, `Link Off ${Date.now()}`);
    const on = await makeSkill(app, `on-${Date.now()}`, 'Included guidance.');
    const off = await makeSkill(app, `off-${Date.now()}`, 'Excluded guidance.');

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: {
        skills: [
          { skill_id: on.id, enabled: true },
          { skill_id: off.id, enabled: false },
        ],
      },
    });

    const block = await skillsBlockFor(app, pr.id, agent.id);
    expect(block).toContain('Included guidance.');
    expect(block).not.toContain('Excluded guidance.');
    await app.close();
  });

  it('leaves out a globally disabled skill even when the link is on', async () => {
    const app = await makeApp();
    const pr = await setupPr();
    const agent = await makeAgent(app, `Global Off ${Date.now()}`);
    const skill = await makeSkill(app, `global-off-${Date.now()}`, 'Globally disabled guidance.');

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skills: [{ skill_id: skill.id, enabled: true }] },
    });
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });

    expect(await skillsBlockFor(app, pr.id, agent.id)).toBeNull();
    await app.close();
  });

  it('logs how many skills were attached and what they cost in tokens', async () => {
    const app = await makeApp();
    const pr = await setupPr();
    const agent = await makeAgent(app, `Logged ${Date.now()}`);
    const skill = await makeSkill(app, `logged-${Date.now()}`, 'Some guidance.');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skills: [{ skill_id: skill.id, enabled: true }] },
    });

    const body = (
      await app.inject({
        method: 'POST',
        url: `/pulls/${pr.id}/review`,
        payload: { agentId: agent.id },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const trace = (await app.inject({ url: `/runs/${body.runs[0].run_id}/trace` })).json();

    const line = trace.log.find((l: { msg: string }) => l.msg.startsWith('skills:'));
    expect(line.msg).toContain('1 attached');
    expect(line.msg).toMatch(/\+~\d+ tokens/);
    expect(line.msg).toContain(skill.name);
    await app.close();
  });
});
