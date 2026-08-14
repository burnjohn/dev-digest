import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review, RunTrace } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[skills-prompt] Docker not available — skipping integration tests.');
}

/**
 * Skills reaching the prompt — the gap this feature exists to close.
 *
 * Before this, `run-executor` never passed `skills` to `reviewPullRequest` and
 * wrote `skills: null` into every trace, so a linked skill was stored, versioned
 * and completely inert. These tests assert against the PERSISTED trace rather
 * than a spy, because the trace is what the user is shown and what the control
 * experiment is read from.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

const RUBRIC_BODY = '# Severity rubric\n\nCRITICAL blocks merge. Do not inflate.';
const GATE_BODY = '# Secret gate\n\nFlag any credential that reaches a client bundle.';

d('skills in the assembled prompt', () => {
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

  function makeApp() {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  async function setupPr() {
    const db = pg.handle.db;
    const name = `payments-api-skills-${repoSeq++}`;
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

  type App = Awaited<ReturnType<typeof makeApp>>;

  async function makeSkill(app: App, name: string, body: string, enabled = true) {
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

  /**
   * Poll `run_traces` for this run's document.
   *
   * `waitForPrRuns` is not enough on its own: `run-executor` flips the run to
   * `done` and writes the trace as two separate statements, so a run can be
   * terminal a moment before its trace exists. Waiting on the status alone
   * passes when the machine is idle and fails when the suite runs in parallel.
   */
  async function waitForTrace(runId: string, timeoutMs = 15_000): Promise<RunTrace> {
    const start = Date.now();
    for (;;) {
      const [row] = await pg.handle.db
        .select()
        .from(t.runTraces)
        .where(eq(t.runTraces.runId, runId));
      if (row) return row.trace as RunTrace;
      if (Date.now() - start > timeoutMs) {
        throw new Error(`no trace persisted for run ${runId} within ${timeoutMs}ms`);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  /** Run one agent against a fresh PR and return the trace it persisted. */
  async function runAndReadTrace(app: App, agentId: string): Promise<RunTrace> {
    const pr = await setupPr();
    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId },
    });
    expect(res.statusCode).toBe(200);
    const [target] = res.json().runs;
    expect(target, 'the review request queued no run').toBeTruthy();

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    return waitForTrace(target.run_id);
  }

  it('renders linked enabled skills as their own block, in link order', async () => {
    const app = await makeApp();
    const rubric = await makeSkill(app, 'ordered-rubric', RUBRIC_BODY);
    const gate = await makeSkill(app, 'ordered-gate', GATE_BODY);
    const agent = await makeAgent(app, 'Ordered Skills Agent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [gate.id, rubric.id] },
    });

    const trace = await runAndReadTrace(app, agent.id);

    expect(trace.prompt_assembly.skills).toBeTruthy();
    // Link order — gate first — is prompt order.
    expect(trace.prompt_assembly.skills!.indexOf(GATE_BODY)).toBeLessThan(
      trace.prompt_assembly.skills!.indexOf(RUBRIC_BODY),
    );
    expect(trace.prompt_assembly.user).toContain('## Skills / rules');
    await app.close();
  });

  it('reports the skills block size so the added tokens are visible', async () => {
    const app = await makeApp();
    const skill = await makeSkill(app, 'sized-rubric', RUBRIC_BODY);
    const agent = await makeAgent(app, 'Sized Skills Agent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const trace = await runAndReadTrace(app, agent.id);
    const sizes = trace.prompt_assembly.section_sizes ?? [];
    const skills = sizes.find((s) => s.section === 'skills');

    expect(skills?.chars).toBe(RUBRIC_BODY.length);
    expect(skills?.est_tokens).toBe(Math.ceil(RUBRIC_BODY.length / 4));
    await app.close();
  });

  it('leaves the skills block out entirely when the agent has none linked', async () => {
    const app = await makeApp();
    const agent = await makeAgent(app, 'Skill-less Agent');

    const trace = await runAndReadTrace(app, agent.id);

    expect(trace.prompt_assembly.skills ?? null).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Skills / rules');
    expect((trace.prompt_assembly.section_sizes ?? []).map((s) => s.section)).not.toContain(
      'skills',
    );
    await app.close();
  });

  it('a DISABLED skill is dropped even though the link still exists', async () => {
    const app = await makeApp();
    const skill = await makeSkill(app, 'kill-switch-rubric', RUBRIC_BODY);
    const agent = await makeAgent(app, 'Kill Switch Agent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const before = await runAndReadTrace(app, agent.id);
    expect(before.prompt_assembly.skills).toContain(RUBRIC_BODY);

    // Global toggle off — the link is untouched.
    await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });
    const links = await app.inject({ method: 'GET', url: `/agents/${agent.id}/skills` });
    expect(links.json()).toHaveLength(1);

    const after = await runAndReadTrace(app, agent.id);
    expect(after.prompt_assembly.skills ?? null).toBeNull();
    await app.close();
  });

  it('the only difference between with- and without-skills is the skills block', async () => {
    // The control experiment rests on this: if anything else in the prompt moved
    // between the two runs, a behaviour difference would not be attributable to
    // the skill.
    const app = await makeApp();
    const bare = await makeAgent(app, 'Baseline Agent');
    const skilled = await makeAgent(app, 'Skilled Agent');
    const skill = await makeSkill(app, 'delta-rubric', RUBRIC_BODY);
    await app.inject({
      method: 'POST',
      url: `/agents/${skilled.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const without = await runAndReadTrace(app, bare.id);
    const with_ = await runAndReadTrace(app, skilled.id);

    const stripSkills = (user: string) =>
      user.replace(`## Skills / rules\n${RUBRIC_BODY}\n\n`, '');
    expect(stripSkills(with_.prompt_assembly.user)).toBe(without.prompt_assembly.user);
    await app.close();
  });
});
