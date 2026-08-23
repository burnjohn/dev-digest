/**
 * PR intent's pre-work step inside a review run (`run-executor.ts`,
 * plan 03-intent-layer.md T6): a PR whose intent already exists costs no
 * model call and is logged; a fresh PR classifies on the CHEAP feature model
 * (`review_intent` → openrouter/deepseek-v4-flash), separate from the
 * reviewing agent's own model (REQ-1/REQ-2); and the resulting intent is
 * threaded into `prompt_assembly.intent` in the persisted run trace
 * (REQ-11). Gated on Docker (needs Postgres).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides, intentLlm } from './helpers/overrides.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { upsertIntent } from '../src/modules/reviews/repository/pull.repo.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

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
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `intent-exec-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: repoSeq,
      title: `PR #${repoSeq}`,
      author: 'octocat',
      branch: `feat/${repoSeq}`,
      base: 'main',
      headSha: `sha${repoSeq}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

function structuredCalls(llm: MockLLMProvider) {
  return llm.calls.filter((c) => c.method === 'completeStructured');
}

d('PR intent inside a review run (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(intentMock: MockLLMProvider, reviewMock: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: hermeticOverrides({
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: reviewMock, openrouter: intentMock },
      }),
    });
  }

  it('a PR whose intent already exists costs NO model call during the run, and the step is logged', async () => {
    const intentMock = intentLlm();
    const reviewMock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(intentMock, reviewMock);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Pre-seed the cached row directly — bypasses the classifier entirely,
    // modelling "intent already exists" (REQ-8's cache-first contract).
    await upsertIntent(
      pg.handle.db,
      pr.id,
      { intent: 'Cached intent text.', in_scope: [], out_of_scope: [], confidence: 'medium', sources: [] },
      { model: 'deepseek/deepseek-v4-flash' },
    );

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'CacheAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // The run made ZERO calls against the intent (openrouter) mock.
    expect(structuredCalls(intentMock)).toHaveLength(0);

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(
      (trace.log as Array<{ msg: string }>).some((l) => l.msg.includes('Deriving PR intent')),
    ).toBe(true);

    await app.close();
  });

  it('REQ-1/REQ-2: classifies on the cheap intent model; the review runs on the agent\'s own, distinct model', async () => {
    const intentMock = intentLlm();
    const reviewMock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(intentMock, reviewMock);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'FreshAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const intentCalls = structuredCalls(intentMock);
    expect(intentCalls).toHaveLength(1);
    expect((intentCalls[0]!.req as { model: string }).model).toBe('deepseek/deepseek-v4-flash');
    expect((intentCalls[0]!.req as { schemaName: string }).schemaName).toBe('IntentClassification');

    const reviewCalls = structuredCalls(reviewMock);
    expect(reviewCalls.length).toBeGreaterThan(0);
    expect((reviewCalls[0]!.req as { model: string }).model).toBe('gpt-4.1');

    // Separate calls on separate mocks — the intent model never touched the
    // agent's provider, and vice versa.
    await app.close();
  });

  it('REQ-11: the classified intent reaches prompt_assembly.intent in the persisted run trace', async () => {
    const intentMock = intentLlm();
    const reviewMock = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(intentMock, reviewMock);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'TraceAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.intent).toBeTruthy();
    expect(trace.prompt_assembly.intent as string).toContain('### Summary');

    await app.close();
  });
});
