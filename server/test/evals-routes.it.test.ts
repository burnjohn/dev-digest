import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides } from './helpers/overrides.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { buildAgentCaseDiff } from '../src/modules/_shared/diff-synth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * T13 — the evals service + routes (SPEC-03, docs/plans/09-eval-pipeline.md).
 * Every batch-running test needs `hermeticOverrides()` (server/INSIGHTS.md,
 * 2026-08-21) — the pipeline reaches `container.llm('openai')` for real.
 *
 * Agents are workspace-scoped state resolved through `LocalNoAuthProvider`'s
 * single default workspace for every HTTP request in this file
 * (server/INSIGHTS.md, 2026-08-17) — `freshRepo()` does NOT isolate an `.it`
 * test here. Every agent this suite creates is torn down in `afterAll`,
 * along with the `eval_cases`/`eval_run_batches` rows it or its tests seeded
 * directly (this task's own acceptance box).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-routes] Docker not available — skipping integration tests.');
}

const AGENT_DIFF = buildAgentCaseDiff('src/x.ts', '@@ -1,0 +1,2 @@\n+line one\n+line two');

interface FindingFixtureOverrides {
  file?: string;
  start_line?: number;
  end_line?: number;
}

function findingFixture(overrides: FindingFixtureOverrides = {}) {
  return {
    id: randomUUID(),
    severity: 'WARNING',
    category: 'bug',
    title: 'issue',
    file: overrides.file ?? 'src/x.ts',
    start_line: overrides.start_line ?? 1,
    end_line: overrides.end_line ?? 1,
    rationale: 'because',
    confidence: 0.9,
  };
}

function expectationFixture(overrides: FindingFixtureOverrides = {}) {
  return {
    severity: 'WARNING',
    category: 'bug',
    title: 'issue',
    file: overrides.file ?? 'src/x.ts',
    start_line: overrides.start_line ?? 1,
    end_line: overrides.end_line ?? 1,
  };
}

function reviewFixture(findings: unknown[] = []) {
  return { verdict: 'comment', summary: 'ok', score: 90, findings };
}

d('modules/evals routes', () => {
  let pg: PgFixture;
  let workspaceId: string;
  const createdAgentIds: string[] = [];

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });

  afterAll(async () => {
    // REQ-69's own note applies in reverse here too: eval_cases/eval_run_batches
    // carry NO FK to agents (`db/schema/eval.ts`), so a raw `delete(t.agents)`
    // would NOT cascade them — T22's cascade only fires through the service.
    // Delete each table this suite touched explicitly, agent last.
    for (const id of createdAgentIds) {
      await pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.ownerId, id));
      await pg.handle.db.delete(t.evalRunBatches).where(eq(t.evalRunBatches.ownerId, id));
      await pg.handle.db.delete(t.agents).where(eq(t.agents.id, id));
    }
    await pg?.stop();
  });

  function makeApp(reviewFindings: unknown[] = []) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: hermeticOverrides({
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        // An agent-owned case runs on the `eval_baseline` feature model
        // (`openrouter` by default), NOT on the agent's own `openai` provider
        // — owner decision, 2026-08-29. `hermeticOverrides()`'s own
        // `openrouter` default only answers the intent schema and throws for
        // anything else (server/INSIGHTS.md, 2026-08-17), so the review fixture
        // must win that key too. `openai` stays mocked: other routes in this
        // file still reach it.
        llm: {
          openai: new MockLLMProvider('openai', { structured: reviewFixture(reviewFindings) }),
          openrouter: new MockLLMProvider('openrouter', { structured: reviewFixture(reviewFindings) }),
        },
      }),
    });
  }

  async function makeAgent(overrides: { enabled?: boolean } = {}) {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: `eval-agent-${randomUUID()}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'Review this diff.',
        enabled: overrides.enabled ?? true,
      })
      .returning();
    createdAgentIds.push(row!.id);
    return row!;
  }

  async function createCase(
    app: Awaited<ReturnType<typeof makeApp>>,
    agentId: string,
    expectedOutput: unknown[] = [],
    overrides: Record<string, unknown> = {},
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/evals/cases',
      payload: {
        owner_kind: 'agent',
        owner_id: agentId,
        name: `case-${randomUUID()}`,
        input_diff: AGENT_DIFF,
        expected_output: expectedOutput,
        ...overrides,
      },
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
    return res.json();
  }

  // ===========================================================================
  // Route inventory — every route declares schema.response
  // ===========================================================================

  it('every route registered in routes.ts declares a response schema', () => {
    const src = readFileSync(resolve(__dirname, '../src/modules/evals/routes.ts'), 'utf-8');
    const routeCount = (src.match(/app\.(get|post|put|delete)\(/g) ?? []).length;
    const responseCount = (src.match(/response:\s*\{/g) ?? []).length;
    expect(routeCount).toBeGreaterThan(0);
    expect(responseCount).toBe(routeCount);
  });

  // ===========================================================================
  // POST /evals/cases — REQ-10, REQ-43
  // ===========================================================================

  describe('POST /evals/cases', () => {
    it('REQ-10 — a malformed expected_output is rejected 422 with a field-level message before anything is persisted; [] is always valid', async () => {
      const app = await makeApp();
      const agent = await makeAgent();
      const before = await pg.handle.db
        .select({ id: t.evalCases.id })
        .from(t.evalCases)
        .where(eq(t.evalCases.ownerId, agent.id));

      const notAnArray = await app.inject({
        method: 'POST',
        url: '/evals/cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'bad-shape',
          input_diff: AGENT_DIFF,
          expected_output: 'not-an-array',
        },
      });
      expect(notAnArray.statusCode).toBe(422);
      expect(notAnArray.json().error.details).toBeDefined();

      const missingFile = await app.inject({
        method: 'POST',
        url: '/evals/cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'missing-file',
          input_diff: AGENT_DIFF,
          expected_output: [
            { severity: 'WARNING', category: 'bug', title: 't', start_line: 1, end_line: 1 },
          ],
        },
      });
      expect(missingFile.statusCode).toBe(422);

      const after = await pg.handle.db
        .select({ id: t.evalCases.id })
        .from(t.evalCases)
        .where(eq(t.evalCases.ownerId, agent.id));
      expect(after.length).toBe(before.length);

      const empty = await createCase(app, agent.id, []);
      expect(empty.expected_output).toEqual([]);

      await app.close();
    });

    it('REQ-43 — a request body carrying expectation_kind is ignored; the stored value is derived from expected_output emptiness', async () => {
      const app = await makeApp();
      const agent = await makeAgent();

      const res = await app.inject({
        method: 'POST',
        url: '/evals/cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'derive-me',
          input_diff: AGENT_DIFF,
          expected_output: [expectationFixture()],
          expectation_kind: 'must_not_flag', // smuggled — the schema strips it; the derivation must win regardless
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().expectation_kind).toBe('must_find');

      const negative = await createCase(app, agent.id, []);
      expect(negative.expectation_kind).toBe('must_not_flag');

      await app.close();
    });
  });

  // ===========================================================================
  // POST /evals/cases/:id/run — REQ-11, REQ-50, REQ-25
  // ===========================================================================

  describe('POST /evals/cases/:id/run', () => {
    it('REQ-11/REQ-50 — runs the case immediately, returns pass/duration/cost in the response, persists a terminal batch of 1 that the dashboard sees, and does not block a subsequent set-run', async () => {
      const app = await makeApp([findingFixture()]);
      const agent = await makeAgent();
      const kase = await createCase(app, agent.id, [expectationFixture()]);

      const res = await app.inject({ method: 'POST', url: `/evals/cases/${kase.id}/run` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.pass).toBe('boolean');
      expect(body.pass).toBe(true);
      expect(typeof body.duration_ms).toBe('number');
      expect(body.cost_usd).not.toBeNull();
      expect(body.run_id).toBeTruthy();
      expect(body.case_id).toBe(kase.id);
      // FIX-1/REQ-64/REQ-67: an agent-owned run's `actual_output` is a bare
      // findings array, not the {with, without} ablation shape — `ablation`
      // is null for it, never a false-positive parse.
      expect(body.ablation).toBeNull();

      // Owner decision 2026-08-29: a single-case run is a BATCH OF 1, not a
      // batch-less run. The dashboard reads `eval_run_batches` alone, so this
      // row is the whole reason the run is visible there at all.
      const batchesAfter = await pg.handle.db
        .select()
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.ownerId, agent.id));
      expect(batchesAfter).toHaveLength(1);
      const soloBatch = batchesAfter[0]!;
      expect(soloBatch.casesTotal).toBe(1);
      expect(soloBatch.casesPassed).toBe(1);
      expect(soloBatch.ownerKind).toBe('agent');
      // Inserted ALREADY TERMINAL — never `running`, which is what keeps it
      // out of REQ-14's live-batch check and out of the boot reaper's reach.
      expect(soloBatch.status).toBe('succeeded');
      expect(soloBatch.finishedAt).not.toBeNull();

      const rows = await pg.handle.db
        .select()
        .from(t.evalRuns)
        .where(eq(t.evalRuns.caseId, kase.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.batchId).toBe(soloBatch.id);

      // Visible on the dashboard — the point of the whole change.
      const dash = await app.inject({ method: 'GET', url: `/evals/dashboard/${agent.id}` });
      expect(dash.statusCode).toBe(200);
      expect(dash.json().recent_batches.map((b: { id: string }) => b.id)).toContain(soloBatch.id);

      // ...and it holds no lock: a set-run started right after is still 202,
      // never REQ-14's 409.
      const setRun = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'agent', owner_id: agent.id },
      });
      expect(setRun.statusCode).toBe(202);

      await app.close();
    });

    it('REQ-25 + vacuous truth — a lone must_not_flag case serializes a perfect 1 on all three metrics, never 0 and never null', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      // must_not_flag, no forbidden_regions, no returned findings -> tp=fn=fp=0
      // on both recall's and precision's denominators.
      const kase = await createCase(app, agent.id, []);

      const res = await app.inject({ method: 'POST', url: `/evals/cases/${kase.id}/run` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // The case RAN with a zero denominator on all three, which the
      // 2026-08-29 vacuous-truth rule scores as a perfect 1, not an em dash.
      expect(body.recall).toBe(1);
      expect(body.precision).toBe(1);
      expect(body.citation_accuracy).toBe(1);
      expect(body.pass).toBe(true);

      // The batch of 1 folds the SAME denominators through the same rule, so
      // the dashboard row and the headline cards agree with the run.
      const [soloBatch] = await pg.handle.db
        .select()
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.ownerId, agent.id));
      expect(soloBatch!.casesTotal).toBe(1);
      expect(soloBatch!.casesPassed).toBe(1);
      expect(soloBatch!.status).toBe('succeeded');
      expect(soloBatch!.recall).toBe(1);
      expect(soloBatch!.precision).toBe(1);
      expect(soloBatch!.citationAccuracy).toBe(1);

      await app.close();
    });
  });

  // ===========================================================================
  // DELETE /evals/cases/:id — REQ-12, REQ-40, REQ-70
  // ===========================================================================

  describe('DELETE /evals/cases/:id', () => {
    it('REQ-12 — deletes the case and its eval_runs rows; REQ-40 — a foreign-workspace case answers 404', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      const kase = await createCase(app, agent.id, []);
      await app.inject({ method: 'POST', url: `/evals/cases/${kase.id}/run` });

      const runsBefore = await pg.handle.db
        .select({ id: t.evalRuns.id })
        .from(t.evalRuns)
        .where(eq(t.evalRuns.caseId, kase.id));
      expect(runsBefore.length).toBeGreaterThan(0);

      const del = await app.inject({ method: 'DELETE', url: `/evals/cases/${kase.id}` });
      expect(del.statusCode).toBe(200);
      expect(del.json()).toEqual({ ok: true });

      const runsAfter = await pg.handle.db
        .select({ id: t.evalRuns.id })
        .from(t.evalRuns)
        .where(eq(t.evalRuns.caseId, kase.id));
      expect(runsAfter).toHaveLength(0);

      const gone = await app.inject({ method: 'DELETE', url: `/evals/cases/${kase.id}` });
      expect(gone.statusCode).toBe(404);

      const [otherWs] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: `other-ws-case-${randomUUID()}` })
        .returning();
      const [foreign] = await pg.handle.db
        .insert(t.evalCases)
        .values({ workspaceId: otherWs!.id, ownerKind: 'agent', ownerId: agent.id, name: 'foreign' })
        .returning();
      const res = await app.inject({ method: 'DELETE', url: `/evals/cases/${foreign!.id}` });
      expect(res.statusCode).toBe(404);

      await pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.id, foreign!.id));
      await pg.handle.db.delete(t.workspaces).where(eq(t.workspaces.id, otherWs!.id));
      await app.close();
    });

    it('REQ-70 — a case referenced by a non-terminal batch answers 409 carrying that batch id, and deletes nothing', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      const kase = await createCase(app, agent.id, []);

      const [runningBatch] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          ownerVersion: agent.version,
          status: 'running',
        })
        .returning();
      await pg.handle.db.insert(t.evalRuns).values({ caseId: kase.id, batchId: runningBatch!.id });

      const res = await app.inject({ method: 'DELETE', url: `/evals/cases/${kase.id}` });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.details.batch_id).toBe(runningBatch!.id);

      const stillThere = await pg.handle.db
        .select({ id: t.evalCases.id })
        .from(t.evalCases)
        .where(eq(t.evalCases.id, kase.id));
      expect(stillThere).toHaveLength(1);

      await app.close();
    });
  });

  // ===========================================================================
  // POST /evals/batches — REQ-13, REQ-14, REQ-15
  // ===========================================================================

  describe('POST /evals/batches', () => {
    it('REQ-13 — answers 202 with a batch id within 500ms, having persisted a running row with owner_kind/owner_id/owner_version before the first model call resolves', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      await createCase(app, agent.id, []);

      const start = Date.now();
      const res = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'agent', owner_id: agent.id },
      });
      const elapsedMs = Date.now() - start;
      expect(res.statusCode).toBe(202);
      expect(elapsedMs).toBeLessThan(500);
      const { batch_id: batchId } = res.json();
      expect(batchId).toBeTruthy();

      const [row] = await pg.handle.db
        .select()
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.id, batchId));
      expect(row).toBeDefined();
      expect(row!.status).toBe('running');
      expect(row!.ownerKind).toBe('agent');
      expect(row!.ownerId).toBe(agent.id);
      expect(row!.ownerVersion).toBe(agent.version);

      await app.close();
    });

    it('REQ-15 — an owner with zero cases answers 400 and creates no batch row', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      const before = await pg.handle.db
        .select({ id: t.evalRunBatches.id })
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.ownerId, agent.id));

      const res = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'agent', owner_id: agent.id },
      });
      expect(res.statusCode).toBe(400);

      const after = await pg.handle.db
        .select({ id: t.evalRunBatches.id })
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.ownerId, agent.id));
      expect(after.length).toBe(before.length);

      await app.close();
    });

    it('REQ-14 — a LIVE second set-run answers 409 with the in-flight batch id and creates no second row', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      await createCase(app, agent.id, []);

      const [running] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          ownerVersion: agent.version,
          status: 'running',
        })
        .returning();

      const res = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'agent', owner_id: agent.id },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.details.batch_id).toBe(running!.id);

      const rows = await pg.handle.db
        .select({ id: t.evalRunBatches.id })
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.ownerId, agent.id));
      expect(rows).toHaveLength(1);

      await app.close();
    });

    it('REQ-14 — a running batch stale for 60+ minutes is served as failed and does not block a new set-run', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      await createCase(app, agent.id, []);

      const staleStart = new Date(Date.now() - 61 * 60 * 1000);
      const [stale] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          ownerVersion: agent.version,
          status: 'running',
          startedAt: staleStart,
        })
        .returning();

      const detail = await app.inject({ method: 'GET', url: `/evals/batches/${stale!.id}` });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().status).toBe('failed');
      // Served, never persisted — the DB row is still literally 'running'.
      const [dbRow] = await pg.handle.db
        .select()
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.id, stale!.id));
      expect(dbRow!.status).toBe('running');

      const res = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'agent', owner_id: agent.id },
      });
      expect(res.statusCode).toBe(202);

      await app.close();
    });
  });

  // ===========================================================================
  // GET /evals/batches/:id — REQ-17 (server half), REQ-40
  // ===========================================================================

  describe('GET /evals/batches/:id', () => {
    it('REQ-17 — answers 200 with the cases completed so far while running, and every case once terminal; never blocks until finished', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      const caseA = await createCase(app, agent.id, []);
      const caseB = await createCase(app, agent.id, []);

      const start = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'agent', owner_id: agent.id },
      });
      expect(start.statusCode).toBe(202);
      const { batch_id: batchId } = start.json();

      // Answers immediately — never waits for the loop to finish.
      const immediate = await app.inject({ method: 'GET', url: `/evals/batches/${batchId}` });
      expect(immediate.statusCode).toBe(200);
      expect(['running', 'succeeded', 'partial', 'failed']).toContain(immediate.json().status);
      expect(Array.isArray(immediate.json().cases)).toBe(true);

      let detail: { status: string; cases: Array<{ case_id: string }> } | undefined;
      for (let i = 0; i < 100; i++) {
        detail = (await app.inject({ method: 'GET', url: `/evals/batches/${batchId}` })).json();
        if (detail!.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(detail!.status).not.toBe('running');
      expect(detail!.cases).toHaveLength(2);
      expect(detail!.cases.map((c) => c.case_id).sort()).toEqual([caseA.id, caseB.id].sort());

      await app.close();
    });

    it('FIX-1/REQ-29-30-32-33-34-37-71: a completed batch persists a non-null recall/precision/citation_accuracy aggregate', async () => {
      const app = await makeApp([findingFixture()]);
      const agent = await makeAgent();
      await createCase(app, agent.id, [expectationFixture()]);

      const start = await app.inject({
        method: 'POST',
        url: '/evals/batches',
        payload: { owner_kind: 'agent', owner_id: agent.id },
      });
      expect(start.statusCode).toBe(202);
      const { batch_id: batchId } = start.json();

      let status = 'running';
      for (let i = 0; i < 100 && status === 'running'; i++) {
        status = (await app.inject({ method: 'GET', url: `/evals/batches/${batchId}` })).json().status;
        if (status === 'running') await new Promise((r) => setTimeout(r, 20));
      }
      expect(status).toBe('succeeded');

      const [row] = await pg.handle.db
        .select()
        .from(t.evalRunBatches)
        .where(eq(t.evalRunBatches.id, batchId));
      expect(row!.recall).toBe(1);
      expect(row!.precision).toBe(1);
      expect(row!.citationAccuracy).toBe(1);

      await app.close();
    });

    it('REQ-40 — a batch belonging to another workspace answers 404, never 403', async () => {
      const app = await makeApp([]);
      const [otherWs] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: `other-ws-batch-${randomUUID()}` })
        .returning();
      const [foreignBatch] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId: otherWs!.id,
          ownerKind: 'agent',
          ownerId: randomUUID(),
          ownerVersion: 1,
          status: 'succeeded',
          finishedAt: new Date(),
        })
        .returning();

      const res = await app.inject({ method: 'GET', url: `/evals/batches/${foreignBatch!.id}` });
      expect(res.statusCode).toBe(404);

      await pg.handle.db.delete(t.evalRunBatches).where(eq(t.evalRunBatches.id, foreignBatch!.id));
      await pg.handle.db.delete(t.workspaces).where(eq(t.workspaces.id, otherWs!.id));
      await app.close();
    });
  });

  // ===========================================================================
  // GET /evals/batches — REQ-31
  // ===========================================================================

  describe('GET /evals/batches', () => {
    it('REQ-31 — returns that owner\'s history ordered started_at desc, id desc, and only that owner\'s', async () => {
      const app = await makeApp([]);
      const agentA = await makeAgent();
      const agentB = await makeAgent();

      const t1 = new Date('2026-01-01T00:00:00Z');
      const t2 = new Date('2026-01-02T00:00:00Z');
      const [b1] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agentA.id,
          ownerVersion: 1,
          status: 'succeeded',
          startedAt: t1,
          finishedAt: t1,
        })
        .returning();
      const [b2] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agentA.id,
          ownerVersion: 1,
          status: 'succeeded',
          startedAt: t2,
          finishedAt: t2,
        })
        .returning();
      await pg.handle.db.insert(t.evalRunBatches).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentB.id,
        ownerVersion: 1,
        status: 'succeeded',
        startedAt: t2,
        finishedAt: t2,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/evals/batches?owner_kind=agent&owner_id=${agentA.id}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().map((b: { id: string }) => b.id)).toEqual([b2!.id, b1!.id]);

      await app.close();
    });
  });

  // ===========================================================================
  // GET /evals/dashboard — REQ-29, REQ-30
  // ===========================================================================

  describe('GET /evals/dashboard', () => {
    it('REQ-29/REQ-30 — one row per ENABLED agent; a disabled agent is absent; a running batch is never served as the latest', async () => {
      const app = await makeApp([]);
      const enabledAgent = await makeAgent({ enabled: true });
      const disabledAgent = await makeAgent({ enabled: false });

      const [terminalBatch] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: enabledAgent.id,
          ownerVersion: 1,
          status: 'succeeded',
          finishedAt: new Date('2026-01-01T00:00:00Z'),
        })
        .returning();
      await pg.handle.db.insert(t.evalRunBatches).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: enabledAgent.id,
        ownerVersion: 1,
        status: 'running',
        startedAt: new Date('2026-02-01T00:00:00Z'),
      });

      const res = await app.inject({ method: 'GET', url: '/evals/dashboard' });
      expect(res.statusCode).toBe(200);
      const rows = res.json() as Array<{ owner_id: string; latest_batch: { id: string } | null }>;
      expect(rows.some((r) => r.owner_id === disabledAgent.id)).toBe(false);
      const row = rows.find((r) => r.owner_id === enabledAgent.id);
      expect(row).toBeDefined();
      expect(row!.latest_batch?.id).toBe(terminalBatch!.id);

      await app.close();
    });
  });

  // ===========================================================================
  // GET /evals/dashboard/:agentId — REQ-32, REQ-33, REQ-37
  // ===========================================================================

  describe('GET /evals/dashboard/:agentId', () => {
    it('returns deltas, the alert (or null), the 30-day trend and the run list in one payload; a single terminal batch returns null deltas and no alert', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      const [only] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          ownerVersion: 1,
          status: 'succeeded',
          finishedAt: new Date(),
          recall: 0.9,
          precision: 0.8,
          citationAccuracy: 1,
        })
        .returning();

      const single = await app.inject({ method: 'GET', url: `/evals/dashboard/${agent.id}` });
      expect(single.statusCode).toBe(200);
      const body1 = single.json();
      expect(body1.delta).toEqual({ recall: null, precision: null, citation_accuracy: null });
      expect(body1.alert).toBeNull();
      expect(body1.recent_batches.map((b: { id: string }) => b.id)).toContain(only!.id);
      expect(Array.isArray(body1.trend)).toBe(true);

      // A second, worse terminal batch: a real delta, and (>= 0.02 fall) an alert.
      await pg.handle.db.insert(t.evalRunBatches).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agent.id,
        ownerVersion: 1,
        status: 'succeeded',
        finishedAt: new Date(Date.now() + 1000),
        recall: 0.5,
        precision: 0.8,
        citationAccuracy: 1,
      });
      const two = await app.inject({ method: 'GET', url: `/evals/dashboard/${agent.id}` });
      const body2 = two.json();
      expect(body2.delta.recall).toBeCloseTo(-0.4);
      expect(body2.alert).not.toBeNull();

      await app.close();
    });
  });

  // ===========================================================================
  // GET /evals/batches/compare — REQ-34, REQ-35, REQ-36, REQ-40
  // ===========================================================================

  describe('GET /evals/batches/compare', () => {
    it('REQ-34/REQ-35 — returns the four deltas plus a line diff for differing owner_version', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();

      const updateRes = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Review this diff. Look harder.' },
      });
      expect(updateRes.statusCode).toBe(200);
      const v2 = updateRes.json().version as number;
      expect(v2).toBe(agent.version + 1);

      const [batchV1] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          ownerVersion: agent.version,
          status: 'succeeded',
          startedAt: new Date('2026-01-01T00:00:00Z'),
          finishedAt: new Date('2026-01-01T00:00:00Z'),
          recall: 0.5,
          precision: 0.5,
          citationAccuracy: 0.5,
          costUsd: 0.01,
        })
        .returning();
      const [batchV2] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          ownerVersion: v2,
          status: 'succeeded',
          startedAt: new Date('2026-01-02T00:00:00Z'),
          finishedAt: new Date('2026-01-02T00:00:00Z'),
          recall: 0.9,
          precision: 0.9,
          citationAccuracy: 0.9,
          costUsd: 0.02,
        })
        .returning();

      const res = await app.inject({
        method: 'GET',
        url: `/evals/batches/compare?a=${batchV1!.id}&b=${batchV2!.id}`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recall).toEqual({ old: 0.5, new: 0.9, delta: 0.4 });
      expect(body.same_version).toBe(false);
      expect(Array.isArray(body.prompt_diff)).toBe(true);
      expect(body.prompt_diff.some((l: { op: string }) => l.op === 'add')).toBe(true);

      await app.close();
    });

    it('REQ-36 — returns the same-version verdict, not an empty array, when owner_version is equal', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      const [b1] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          ownerVersion: agent.version,
          status: 'succeeded',
          startedAt: new Date('2026-01-01T00:00:00Z'),
          finishedAt: new Date('2026-01-01T00:00:00Z'),
        })
        .returning();
      const [b2] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          ownerVersion: agent.version,
          status: 'succeeded',
          startedAt: new Date('2026-01-02T00:00:00Z'),
          finishedAt: new Date('2026-01-02T00:00:00Z'),
        })
        .returning();

      const res = await app.inject({
        method: 'GET',
        url: `/evals/batches/compare?a=${b1!.id}&b=${b2!.id}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().same_version).toBe(true);
      expect(res.json().prompt_diff).toBeNull();

      await app.close();
    });

    it('REQ-40 — self-compare is rejected, and a batch from another workspace answers 404', async () => {
      const app = await makeApp([]);
      const agent = await makeAgent();
      const [batch] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId,
          ownerKind: 'agent',
          ownerId: agent.id,
          ownerVersion: agent.version,
          status: 'succeeded',
          finishedAt: new Date(),
        })
        .returning();

      const self = await app.inject({
        method: 'GET',
        url: `/evals/batches/compare?a=${batch!.id}&b=${batch!.id}`,
      });
      expect(self.statusCode).toBe(400);

      const [otherWs] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: `other-ws-cmp-${randomUUID()}` })
        .returning();
      const [foreign] = await pg.handle.db
        .insert(t.evalRunBatches)
        .values({
          workspaceId: otherWs!.id,
          ownerKind: 'agent',
          ownerId: randomUUID(),
          ownerVersion: 1,
          status: 'succeeded',
          finishedAt: new Date(),
        })
        .returning();
      const cross = await app.inject({
        method: 'GET',
        url: `/evals/batches/compare?a=${batch!.id}&b=${foreign!.id}`,
      });
      expect(cross.statusCode).toBe(404);

      await pg.handle.db.delete(t.evalRunBatches).where(eq(t.evalRunBatches.id, foreign!.id));
      await pg.handle.db.delete(t.workspaces).where(eq(t.workspaces.id, otherWs!.id));
      await app.close();
    });
  });
});
