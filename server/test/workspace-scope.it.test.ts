import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { AuthProvider, RunTrace } from '@devdigest/shared';
import * as reviewRepo from '../src/modules/reviews/repository/review.repo.js';
import { getRunTrace } from '../src/modules/reviews/repository/run.repo.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** AuthProvider pinned to a specific workspace — simulates a second tenant. */
function authFor(workspaceId: string, userId: string): AuthProvider {
  return {
    currentUser: async () => ({ id: userId, email: 'b@example.com', name: 'B' }),
    currentWorkspace: async () => ({ id: workspaceId, name: 'ws-b' }),
  };
}

const VALID_TRACE: RunTrace = {
  config: { agent: 'general', model: 'gpt-test', source: 'local' },
  stats: {
    duration_ms: 1,
    tokens_in: 1,
    tokens_out: 1,
    cost_usd: null,
    findings: 0,
    grounding: '0/0 passed',
  },
  prompt_assembly: { system: 'sys', user: 'usr' },
  tool_calls: [],
  raw_output: '',
  memory_pulled: [],
  specs_read: [],
  log: [],
};

d('workspace scoping — runs, traces, findings, repo-intel (Testcontainers pg)', () => {
  let pg: PgFixture;
  let wsA: string;
  let wsB: string;
  let userId: string;
  let appA: Awaited<ReturnType<typeof buildApp>>;
  let appB: Awaited<ReturnType<typeof buildApp>>;
  let repoId: string;
  let prId: string;
  let runId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces);
    wsA = ws!.id;
    const [user] = await db.select().from(t.users);
    userId = user!.id;
    const [wsbRow] = await db.insert(t.workspaces).values({ name: 'ws-b' }).returning();
    wsB = wsbRow!.id;

    // A repo + PR + a running agent_run + a persisted trace, all owned by workspace A.
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: wsA, owner: 'acme', name: 'scoped', fullName: 'acme/scoped' })
      .returning();
    repoId = repo!.id;
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: wsA,
        repoId,
        number: 7,
        title: 'scoping fixture',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'abc',
        additions: 0,
        deletions: 0,
        filesCount: 0,
        status: 'needs_review',
      })
      .returning();
    prId = pr!.id;

    appA = await buildApp({ config: config(), db });
    appB = await buildApp({
      config: config(),
      db,
      overrides: { auth: authFor(wsB, userId) },
    });

    // AFTER buildApp: the boot reaper flips every 'running' run to 'failed'
    // (INSIGHTS 2026-08-01), so the fixture run must be inserted post-boot.
    const [run] = await db
      .insert(t.agentRuns)
      .values({ workspaceId: wsA, prId, status: 'running', source: 'local' })
      .returning();
    runId = run!.id;
    await db.insert(t.runTraces).values({ runId, trace: VALID_TRACE });
  });

  afterAll(async () => {
    await appB?.close();
    await appA?.close();
    await pg?.stop();
  });

  it('POST /runs/:id/cancel from another workspace answers 404 and leaves the run running', async () => {
    const res = await appB.inject({ method: 'POST', url: `/runs/${runId}/cancel` });
    expect(res.statusCode).toBe(404);
    const [row] = await pg.handle.db
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, runId));
    expect(row!.status).toBe('running');
  });

  it('GET /runs/:id/trace from another workspace answers 404', async () => {
    const res = await appB.inject({ method: 'GET', url: `/runs/${runId}/trace` });
    expect(res.statusCode).toBe(404);
  });

  it('GET /runs/:id/trace from the owning workspace still answers 200', async () => {
    const res = await appA.inject({ method: 'GET', url: `/runs/${runId}/trace` });
    expect(res.statusCode).toBe(200);
    expect(res.json().config.agent).toBe('general');
  });

  it('GET /runs/:id/events from another workspace answers 404 instead of replaying the log', async () => {
    // Publish + complete so the (unfixed) SSE stream would end and inject returns.
    appB.container.runBus.publish(runId, 'info', 'secret progress line');
    appB.container.runBus.complete(runId);
    const res = await appB.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(res.statusCode).toBe(404);
  });

  it('GET /repos/:id/index-state from another workspace answers 404', async () => {
    const res = await appB.inject({ method: 'GET', url: `/repos/${repoId}/index-state` });
    expect(res.statusCode).toBe(404);
  });

  it('GET /repos/:id/index-state from the owning workspace still answers 200 (degraded)', async () => {
    const res = await appA.inject({ method: 'GET', url: `/repos/${repoId}/index-state` });
    expect(res.statusCode).toBe(200);
  });

  it('POST /repos/:id/resync from another workspace answers 404', async () => {
    const res = await appB.inject({ method: 'POST', url: `/repos/${repoId}/resync` });
    expect(res.statusCode).toBe(404);
  });

  it('finding accept/dismiss UPDATEs carry the workspace predicate themselves', async () => {
    const db = pg.handle.db;
    const review = await reviewRepo.insertReview(db, {
      workspaceId: wsA,
      prId,
      agentId: null,
      runId: null,
      kind: 'review',
      verdict: null,
      summary: null,
      score: null,
      model: null,
    });
    const [finding] = await reviewRepo.insertFindings(db, review.id, [
      {
        id: 'f-1',
        severity: 'WARNING',
        category: 'bug',
        title: 'scoped finding',
        file: 'a.ts',
        start_line: 1,
        end_line: 1,
        rationale: 'r',
        confidence: 0.5,
        kind: 'finding',
      },
    ]);

    // Wrong workspace: no write, no row returned.
    const cross = await reviewRepo.setFindingAccepted(db, wsB, finding!.id, new Date());
    expect(cross).toBeUndefined();
    let [row] = await db.select().from(t.findings).where(eq(t.findings.id, finding!.id));
    expect(row!.acceptedAt).toBeNull();

    // Owning workspace: the update lands.
    const owned = await reviewRepo.setFindingAccepted(db, wsA, finding!.id, new Date());
    expect(owned?.acceptedAt).not.toBeNull();

    const crossDismiss = await reviewRepo.setFindingDismissed(db, wsB, finding!.id, new Date());
    expect(crossDismiss).toBeUndefined();
    [row] = await db.select().from(t.findings).where(eq(t.findings.id, finding!.id));
    expect(row!.dismissedAt).toBeNull();
    expect(row!.acceptedAt).not.toBeNull();
  });

  it('getRunTrace rejects a persisted trace that fails the RunTrace contract', async () => {
    const db = pg.handle.db;
    const [run] = await db
      .insert(t.agentRuns)
      .values({ workspaceId: wsA, prId, status: 'done', source: 'local' })
      .returning();
    await db.insert(t.runTraces).values({ runId: run!.id, trace: { bogus: true } });
    await expect(getRunTrace(db, wsA, run!.id)).rejects.toThrow(/RunTrace/);
  });
});
