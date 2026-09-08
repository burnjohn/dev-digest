import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { EVAL_FIXTURE_CASES } from '../src/db/seed-eval-cases.js';
import { RUN_RATE_LIMIT } from '../src/modules/eval/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval] Docker not available — skipping integration tests.');
}

/**
 * specs/12-eval-pipeline.md D21/AC-57 — the DB-backed half of `verify:l06`:
 * migrations apply, the eval routes respond over their documented surface,
 * and workspace scoping refuses. Self-skips without Docker.
 */
d('eval module (DB-backed)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(structured?: unknown) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structured: {
              verdict: 'comment',
              summary: 'ok',
              score: 90,
              findings: [],
            },
          }),
        },
      },
    });
  }

  async function securityReviewerId(): Promise<string> {
    const [row] = await pg.handle.db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    return row!.id;
  }

  /** R2/AC-30/AC-31 — the seeded skill-owned fixture, four cases (two of each
   *  expectation type), carried by `Security Reviewer`. */
  async function secretLeakageGateId(): Promise<string> {
    const [row] = await pg.handle.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, 'secret-leakage-gate')));
    return row!.id;
  }

  /** AC-27 — a SEPARATE app instance, built with a non-`test` `NODE_ENV`, so
   *  `@fastify/rate-limit` is actually registered (`app.ts`: "Disabled under
   *  test so integration suites can hammer endpoints via inject()"). The
   *  per-route `config.rateLimit` on `/agents/:id/eval/runs` is otherwise
   *  inert plugin metadata with no hook to enforce it. */
  function makeRateLimitedApp() {
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: {
          openrouter: new MockLLMProvider('openai', {
            structured: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
          }),
        },
      },
    });
  }

  async function waitForRunCompletion(
    app: Awaited<ReturnType<typeof buildApp>>,
    runId: string,
  ): Promise<{ status: string; [k: string]: unknown }> {
    let final: { status: string; [k: string]: unknown } = { status: 'running' };
    for (let i = 0; i < 50 && final.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      final = (await app.inject({ method: 'GET', url: `/eval/runs/${runId}` })).json();
    }
    return final;
  }

  it('D22 — the seed produced exactly 7 fixture cases, both expectation types present', async () => {
    const agentId = await securityReviewerId();
    const rows = await pg.handle.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerKind, 'agent'), eq(t.evalCases.ownerId, agentId)));
    expect(rows).toHaveLength(7);
    const types = new Set(rows.map((r) => (r.expectedOutput as { type: string }).type));
    expect(types.has('must_find')).toBe(true);
    expect(types.has('must_not_flag')).toBe(true);
    expect(rows.map((r) => r.name).sort()).toEqual(EVAL_FIXTURE_CASES.map((c) => c.name).sort());
  });

  it('GET /agents/:id/eval/cases lists the seeded fixture cases', async () => {
    const app = await makeApp();
    const agentId = await securityReviewerId();
    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval/cases` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(7);
    await app.close();
  });

  it('GET /agents/:id/eval/estimate states the case count before any run', async () => {
    const app = await makeApp();
    const agentId = await securityReviewerId();
    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval/estimate` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ agents_total: 1, cases_total: 7, executions_total: 7 });
    await app.close();
  });

  it('runs the full suite: start → poll → completed, with zero-LLM reads before/after', async () => {
    const app = await makeApp();
    const agentId = await securityReviewerId();

    const started = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval/runs` });
    expect(started.statusCode).toBe(202);
    const { run_id, status, estimate } = started.json();
    expect(status).toBe('running');
    expect(estimate).toMatchObject({ agents_total: 1, cases_total: 7, executions_total: 7 });

    let final = started.json();
    for (let i = 0; i < 50 && final.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      final = (await app.inject({ method: 'GET', url: `/eval/runs/${run_id}` })).json();
    }
    expect(final.status).toBe('completed');
    expect(final.metrics).not.toBeNull();
    expect(final.metrics.traces_total).toBe(7);
    expect(final.case_ids).toHaveLength(7);
    await app.close();
  }, 20_000);

  it('AC-15 — two rapid run triggers on one agent produce exactly one run', async () => {
    const app = await makeApp();
    const agentId = await securityReviewerId();

    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: `/agents/${agentId}/eval/runs` }),
      app.inject({ method: 'POST', url: `/agents/${agentId}/eval/runs` }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    // One succeeds (202); the other is refused (409, run_in_flight) — the
    // exact response race is nondeterministic, but exactly one row exists.
    expect(statuses).toContain(202);

    // Let the run finish before counting, so a later test's own run doesn't
    // collide with this one's in-flight guard.
    await new Promise((r) => setTimeout(r, 500));
    await app.close();
  });

  it('AC-54 — a request for another workspace agent/case/run is refused', async () => {
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-eval-ws' }).returning();
    const [foreignAgent] = await db
      .insert(t.agents)
      .values({
        workspaceId: otherWs!.id,
        name: 'Foreign Agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'x',
      })
      .returning();

    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/eval/agents/${foreignAgent!.id}` });
    expect(res.statusCode).toBe(404);
    const estimateRes = await app.inject({
      method: 'GET',
      url: `/agents/${foreignAgent!.id}/eval/estimate`,
    });
    expect(estimateRes.statusCode).toBe(404);
    await app.close();
  });

  it('GET /eval/dashboard responds with the seeded agent summarized', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/eval/dashboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const security = body.agents.find((a: { agent_name: string }) => a.agent_name === 'Security Reviewer');
    expect(security).toBeDefined();
    expect(security.cases_total).toBe(7);
    await app.close();
  });

  it('D18 — deleting the agent deletes its eval cases and runs', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const [agent] = await db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Disposable Agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'x',
      })
      .returning();

    await db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agent!.id,
      name: 'disposable-case',
      inputDiff: '@@ -1,1 +1,1 @@\n-x\n+y',
      inputFiles: ['f.ts'],
      inputMeta: { pr_number: null, title: 't', body: null },
      expectedOutput: { type: 'must_find', file: 'f.ts', start_line: 1, end_line: 1 },
    });

    const del = await app.inject({ method: 'DELETE', url: `/agents/${agent!.id}` });
    expect(del.statusCode).toBe(200);

    const remaining = await db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerKind, 'agent'), eq(t.evalCases.ownerId, agent!.id)));
    expect(remaining).toHaveLength(0);
    await app.close();
  });

  it('AC-27 — repeated run triggers on one agent hit the rate limit rather than starting unbounded executions', async () => {
    const app = await makeRateLimitedApp();
    const agentId = await securityReviewerId();

    // Sequential (not Promise.all) so ordering through the rate limiter's
    // window is deterministic: the first RUN_RATE_LIMIT.max requests must
    // clear the limiter (whatever their own business-logic status — 202 for
    // a fresh start, 409 for AC-15's in-flight guard); only the request past
    // that budget is refused by the limiter itself, before the handler runs.
    const statuses: number[] = [];
    for (let i = 0; i < RUN_RATE_LIMIT.max + 1; i++) {
      const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval/runs` });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, RUN_RATE_LIMIT.max)).not.toContain(429);
    expect(statuses[RUN_RATE_LIMIT.max]).toBe(429);

    // Let any run(s) started above finish before the next test reuses this
    // agent, so its own in-flight guard doesn't collide with these.
    await new Promise((r) => setTimeout(r, 500));
    await app.close();
  }, 20_000);

  it('AC-26/AC-28 — a completed run displays cost and duration; every read route makes zero provider calls', async () => {
    const app = await makeApp();
    const agentId = await securityReviewerId();

    // Two completed runs of the same agent, so the sweep below can also
    // exercise GET /eval/compare.
    const first = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval/runs` })).json();
    const firstFinal = await waitForRunCompletion(app, first.run_id);
    expect(firstFinal.status).toBe('completed');

    const second = (await app.inject({ method: 'POST', url: `/agents/${agentId}/eval/runs` })).json();
    const secondFinal = await waitForRunCompletion(app, second.run_id);
    expect(secondFinal.status).toBe('completed');
    await app.close();

    // AC-26 — cost and duration are stated on the completed run, both at the
    // record level and inside its metrics object, never left absent.
    const metrics = secondFinal.metrics as { duration_ms: number; cost_usd: number | null };
    expect(secondFinal.duration_ms).toEqual(expect.any(Number));
    expect(secondFinal.cost_usd).not.toBeNull();
    expect(metrics.duration_ms).toEqual(expect.any(Number));
    expect(metrics.cost_usd).not.toBeNull();

    // AC-28 — repeated loads of every eval surface against a FRESH, isolated
    // provider make zero calls to it. A fresh instance (rather than reusing
    // the one that ran the two suites above) means any call here is
    // unambiguously caused by a read route, not leftover from the runs.
    const spyLlm = new MockLLMProvider('openai', {
      structured: { verdict: 'comment', summary: 'ok', score: 90, findings: [] },
    });
    const readApp = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openrouter: spyLlm },
      },
    });

    const responses = await Promise.all([
      readApp.inject({ method: 'GET', url: '/eval/dashboard' }),
      readApp.inject({ method: 'GET', url: `/eval/agents/${agentId}` }),
      readApp.inject({ method: 'GET', url: `/agents/${agentId}/eval/cases` }),
      readApp.inject({ method: 'GET', url: `/agents/${agentId}/eval/runs` }),
      readApp.inject({ method: 'GET', url: `/eval/runs/${first.run_id}` }),
      readApp.inject({ method: 'GET', url: `/eval/compare?a=${first.run_id}&b=${second.run_id}` }),
    ]);
    for (const res of responses) expect(res.statusCode).toBe(200);
    expect(spyLlm.calls).toHaveLength(0);

    await readApp.close();
  }, 30_000);

  it('D17 — the eval_cases_source_finding_uq DB constraint refuses a second row for the same finding', async () => {
    const { db } = pg.handle;
    const agentId = await securityReviewerId();
    const findingId = randomUUID();

    const caseValues = (name: string) => ({
      workspaceId,
      ownerKind: 'agent' as const,
      ownerId: agentId,
      name,
      inputDiff: '@@ -1,1 +1,1 @@\n-x\n+y',
      inputFiles: ['f.ts'],
      inputMeta: { pr_number: null, title: 't', body: null },
      expectedOutput: { type: 'must_find' as const, file: 'f.ts', start_line: 1, end_line: 1 },
      sourceFindingId: findingId,
    });

    try {
      await db.insert(t.evalCases).values(caseValues('first'));
      await expect(db.insert(t.evalCases).values(caseValues('second'))).rejects.toMatchObject({
        code: '23505',
      });
    } finally {
      await db.delete(t.evalCases).where(eq(t.evalCases.sourceFindingId, findingId));
    }
  });

  // ===========================================================================
  // specs/15-skill-eval-cases.md §7 — skill-owned eval routes (AC-45, AC-53,
  // AC-55). Follows this file's existing setup/teardown and fixture patterns
  // exactly — no new test harness.
  // ===========================================================================
  describe('skill-owned eval routes', () => {
    it('AC-2 — GET /findings/:id/eval-skills returns the empty-offer state for a finding whose review predates run_skills', async () => {
      const app = await makeApp();
      const [findingRow] = await pg.handle.db
        .select({ id: t.findings.id })
        .from(t.findings)
        .where(eq(t.findings.title, 'Hardcoded Stripe secret key in commit'));
      const res = await app.inject({
        method: 'GET',
        url: `/findings/${findingRow!.id}/eval-skills`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
      await app.close();
    });

    it('serves the skill routes over their documented surface: cases (incl. AC-8 hand-authored), carriers, estimate, a full two-arm run, and compare', async () => {
      const app = await makeApp();
      const skillId = await secretLeakageGateId();
      const carrierId = await securityReviewerId();

      const casesRes = await app.inject({ method: 'GET', url: `/skills/${skillId}/eval/cases` });
      expect(casesRes.statusCode).toBe(200);
      expect(casesRes.json()).toHaveLength(4);

      // AC-11 — the carrier picker states both gate states.
      const carriersRes = await app.inject({ method: 'GET', url: `/skills/${skillId}/eval/carriers` });
      expect(carriersRes.statusCode).toBe(200);
      const securityCarrier = carriersRes
        .json()
        .find((c: { agent_id: string }) => c.agent_id === carrierId);
      expect(securityCarrier).toMatchObject({ skill_enabled: true, link_enabled: true });

      // AC-8 — hand-authored case creation, same shape as `EvalCaseInput`.
      const createCaseRes = await app.inject({
        method: 'POST',
        url: `/skills/${skillId}/eval/cases`,
        payload: {
          name: 'hand-authored-case',
          input_diff:
            'diff --git a/src/handler.ts b/src/handler.ts\n--- a/src/handler.ts\n+++ b/src/handler.ts\n@@ -1,1 +1,1 @@\n-x\n+const key = "sk_live_abcdef";',
          input_files: ['src/handler.ts'],
          input_meta: { pr_number: null, title: 'hand-authored', body: null },
          expectation: { type: 'must_find', file: 'src/handler.ts', start_line: 1, end_line: 1 },
        },
      });
      expect(createCaseRes.statusCode).toBe(201);

      // AC-25 — executions_total is 2 x cases_total, stated before any run.
      const estimateRes = await app.inject({
        method: 'GET',
        url: `/skills/${skillId}/eval/estimate?carrier_agent_id=${carrierId}`,
      });
      expect(estimateRes.statusCode).toBe(200);
      const estimate = estimateRes.json();
      expect(estimate.cases_total).toBe(5);
      expect(estimate.executions_total).toBe(10);
      expect(estimate.gates_bypassed).toBe(false);

      const startRes = await app.inject({
        method: 'POST',
        url: `/skills/${skillId}/eval/runs`,
        payload: { carrier_agent_id: carrierId },
      });
      expect(startRes.statusCode).toBe(202);
      const { run_id: firstRunId, status, estimate: startEstimate } = startRes.json();
      expect(status).toBe('running');
      expect(startEstimate.executions_total).toBe(10);

      const final = await waitForRunCompletion(app, firstRunId);
      expect(final.status).toBe('completed');
      // R1/D6 — the skill-owned identity columns and the derived two-arm
      // figures ride alongside the base `EvalRunRecord` fields (AC-18).
      expect(final.skill_version).toEqual(expect.any(Number));
      expect(final.carrier_agent_id).toBe(carrierId);
      expect(final.carrier_agent_name).toBe('Security Reviewer');
      expect(final.gates_bypassed).toBe(false);
      expect(final.arm_without).not.toBeNull();
      expect(final.lift).not.toBeNull();
      expect(Array.isArray(final.effects)).toBe(true);
      const counts = final.effect_counts as Record<string, number>;
      expect(counts.helped + counts.hurt + counts.no_effect_pass + counts.no_effect_fail).toBe(5);

      const listRunsRes = await app.inject({ method: 'GET', url: `/skills/${skillId}/eval/runs` });
      expect(listRunsRes.statusCode).toBe(200);
      expect(listRunsRes.json().some((r: { id: string }) => r.id === firstRunId)).toBe(true);

      // A second completed run of the same skill, so compare has two records.
      const secondStart = await app.inject({
        method: 'POST',
        url: `/skills/${skillId}/eval/runs`,
        payload: { carrier_agent_id: carrierId },
      });
      expect(secondStart.statusCode).toBe(202);
      const secondFinal = await waitForRunCompletion(app, secondStart.json().run_id);
      expect(secondFinal.status).toBe('completed');

      // AC-32/AC-33 — compare over the two skill-owned runs.
      const compareRes = await app.inject({
        method: 'GET',
        url: `/eval/skills/compare?a=${firstRunId}&b=${secondFinal.id}`,
      });
      expect(compareRes.statusCode).toBe(200);
      const compare = compareRes.json();
      expect(compare.carrier_differs).toBe(false);
      expect(compare.old.id).toBeDefined();
      expect(compare.new.id).toBeDefined();
      expect(Array.isArray(compare.skill_body_diff)).toBe(true);

      await app.close();
    }, 30_000);

    it('AC-26 — POST /eval/skills/runs/all runs every skill owning cases with a deterministically auto-selected carrier', async () => {
      const app = await makeApp();
      const skillId = await secretLeakageGateId();

      const res = await app.inject({
        method: 'POST',
        url: '/eval/skills/runs/all',
        payload: { confirm: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const entry = body.started.find((s: { skill_id: string }) => s.skill_id === skillId);
      expect(entry).toBeDefined();
      expect(entry.carrier_agent_name).toBe('Security Reviewer');
      expect(entry.run_id).not.toBeNull();

      const final = await waitForRunCompletion(app, entry.run_id);
      expect(final.status).toBe('completed');

      await app.close();
    }, 30_000);

    it('AC-53 — a cross-workspace carrier is refused before any case row is read', async () => {
      const { db } = pg.handle;
      const [otherWs] = await db
        .insert(t.workspaces)
        .values({ name: 'other-skill-eval-ws' })
        .returning();
      const [foreignAgent] = await db
        .insert(t.agents)
        .values({
          workspaceId: otherWs!.id,
          name: 'Foreign Skill Agent',
          provider: 'openai',
          model: 'gpt-4o-mini',
          systemPrompt: 'x',
        })
        .returning();

      // A brand-new skill in THIS workspace with ZERO eval cases. Case-count
      // order matters here: if the implementation read cases before
      // resolving the carrier, this would 422 `no_cases` instead — the
      // AC-53 order (resolve skill + carrier, BOTH workspace-scoped, before
      // any case row is read) means the cross-workspace carrier is refused
      // first, with a 404, regardless of the empty case set.
      const [emptySkill] = await db
        .insert(t.skills)
        .values({
          workspaceId,
          name: `empty-skill-${randomUUID().slice(0, 8)}`,
          description: 'no cases',
          type: 'custom',
          source: 'manual',
          body: 'x',
          enabled: true,
          version: 1,
        })
        .returning();

      const app = await makeApp();
      const res = await app.inject({
        method: 'POST',
        url: `/skills/${emptySkill!.id}/eval/runs`,
        payload: { carrier_agent_id: foreignAgent!.id },
      });
      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('AC-45 — a skill’s GET /skills/:id/stats payload is byte-identical before and after a completed eval run', async () => {
      const app = await makeApp();
      const skillId = await secretLeakageGateId();
      const carrierId = await securityReviewerId();

      const before = await app.inject({ method: 'GET', url: `/skills/${skillId}/stats` });
      expect(before.statusCode).toBe(200);

      const startRes = await app.inject({
        method: 'POST',
        url: `/skills/${skillId}/eval/runs`,
        payload: { carrier_agent_id: carrierId },
      });
      expect(startRes.statusCode).toBe(202);
      const final = await waitForRunCompletion(app, startRes.json().run_id);
      expect(final.status).toBe('completed');

      const after = await app.inject({ method: 'GET', url: `/skills/${skillId}/stats` });
      expect(after.statusCode).toBe(200);
      expect(after.json()).toEqual(before.json());

      await app.close();
    }, 20_000);
  });
});
