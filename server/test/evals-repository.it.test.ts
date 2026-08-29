import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { EvalsRepository } from '../src/modules/evals/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-repository] Docker not available — skipping integration tests.');
}

/**
 * `EvalsRepository` against a real Postgres (T7, SPEC-03). Every test creates
 * its OWN workspace via `freshWorkspace()` and threads that id through every
 * call — unlike `conventions.it.test.ts`'s `freshRepo()`, which shares ONE
 * workspace resolved by `LocalNoAuthProvider` for every HTTP request
 * (`server/INSIGHTS.md`, 2026-08-17), this suite talks to the repository
 * directly with an explicit `workspaceId` per test, so there is no default-
 * workspace channel for state to leak through. `hermeticOverrides()` does not
 * apply here either: nothing in this file touches `container`, an LLM, or
 * GitHub — it is Drizzle against Postgres only.
 *
 * The suite still deletes every agent/skill/`agent_skills` row it seeds
 * (REQ-69 and the cross-table-read test) before it closes, per this task's
 * own acceptance box.
 */
d('EvalsRepository', () => {
  let pg: PgFixture;
  let repo: EvalsRepository;
  let wsSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    repo = new EvalsRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function freshWorkspace(): Promise<string> {
    wsSeq += 1;
    const [row] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `evals-ws-${wsSeq}` })
      .returning();
    return row!.id;
  }

  // ===========================================================================
  // REQ-7 — case list: filtered by workspace + owner kind + owner id, name asc/id asc
  // ===========================================================================

  it('REQ-7 — lists cases scoped by all three of workspace/owner_kind/owner_id, ordered name asc id asc, stably across refetches', async () => {
    const ws = await freshWorkspace();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();

    // Two cases sharing a name — the id tie-break must keep them in one order.
    const caseA = await repo.insertCase({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'duplicate name',
    });
    const caseB = await repo.insertCase({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'duplicate name',
    });
    // Noise: different owner id, different owner kind, different workspace —
    // none of these may appear in the scoped list.
    await repo.insertCase({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId: otherAgentId,
      name: 'other owner',
    });
    await repo.insertCase({
      workspaceId: ws,
      ownerKind: 'skill',
      ownerId: agentId,
      name: 'wrong owner kind',
    });
    const otherWs = await freshWorkspace();
    await repo.insertCase({
      workspaceId: otherWs,
      ownerKind: 'agent',
      ownerId: agentId,
      name: 'other workspace',
    });

    const first = await repo.listCases(ws, 'agent', agentId);
    const second = await repo.listCases(ws, 'agent', agentId);

    expect(first.map((c) => c.id).sort()).toEqual([caseA.id, caseB.id].sort());
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id)); // stable across refetches
    // The two same-named rows are consecutive and ordered by id (the tie-break).
    const [a, b] = first;
    expect([a!.id, b!.id].sort()).toEqual([caseA.id, caseB.id].sort());
    expect(a!.id < b!.id).toBe(true);
  });

  // ===========================================================================
  // REQ-12 — deleting a case deletes its eval_runs rows
  // ===========================================================================

  it('REQ-12 — deleting a case deletes its eval_runs rows', async () => {
    const ws = await freshWorkspace();
    const kase = await repo.insertCase({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId: randomUUID(),
      name: 'case with runs',
    });
    await repo.insertRun({ caseId: kase.id, pass: true });
    await repo.insertRun({ caseId: kase.id, pass: false });

    const runsBefore = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.caseId, kase.id));
    expect(runsBefore).toHaveLength(2);

    const deleted = await repo.deleteCase(ws, kase.id);
    expect(deleted).toBe(true);

    const runsAfter = await pg.handle.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.caseId, kase.id));
    expect(runsAfter).toHaveLength(0);
  });

  // ===========================================================================
  // REQ-28 — a run row round-trips pass/metrics/duration/cost/actual_output/batch_id
  // ===========================================================================

  it('REQ-28 — a run row round-trips pass, the three metrics, duration_ms, cost_usd, actual_output, with batch_id nullable', async () => {
    const ws = await freshWorkspace();
    const kase = await repo.insertCase({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId: randomUUID(),
      name: 'round trip case',
    });
    const batch = await repo.insertBatch({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId: randomUUID(),
      ownerVersion: 1,
    });

    const withBatch = await repo.insertRun({
      caseId: kase.id,
      batchId: batch.id,
      pass: true,
      recall: 0.75,
      precision: 0.5,
      citationAccuracy: 1,
      durationMs: 1234,
      costUsd: 0.021,
      actualOutput: { findings: [{ title: 'x' }] },
    });
    expect(withBatch.batchId).toBe(batch.id);
    expect(withBatch.pass).toBe(true);
    expect(withBatch.recall).toBe(0.75);
    expect(withBatch.precision).toBe(0.5);
    expect(withBatch.citationAccuracy).toBe(1);
    expect(withBatch.durationMs).toBe(1234);
    expect(withBatch.costUsd).toBe(0.021);
    expect(withBatch.actualOutput).toEqual({ findings: [{ title: 'x' }] });

    // batch_id is nullable — an ad-hoc single-case run has none.
    const withoutBatch = await repo.insertRun({ caseId: kase.id, pass: null });
    expect(withoutBatch.batchId).toBeNull();
  });

  // ===========================================================================
  // REQ-30 — latest terminal batch: greatest finished_at, id tie-break, never running
  // ===========================================================================

  it('REQ-30 — latest batch is the terminal row with greatest finished_at, id breaking a tie; a running batch is never selected', async () => {
    const ws = await freshWorkspace();
    const ownerId = randomUUID();
    const older = await repo.insertBatch({ workspaceId: ws, ownerKind: 'agent', ownerId, ownerVersion: 1 });
    await repo.completeBatch(ws, older.id, {
      status: 'succeeded',
      finishedAt: new Date('2026-01-01T00:00:00Z'),
    });

    // Two batches tied on finished_at — id must break the tie.
    const tieFinishedAt = new Date('2026-02-01T00:00:00Z');
    const tieA = await repo.insertBatch({ workspaceId: ws, ownerKind: 'agent', ownerId, ownerVersion: 2 });
    const tieB = await repo.insertBatch({ workspaceId: ws, ownerKind: 'agent', ownerId, ownerVersion: 2 });
    await repo.completeBatch(ws, tieA.id, { status: 'succeeded', finishedAt: tieFinishedAt });
    await repo.completeBatch(ws, tieB.id, { status: 'succeeded', finishedAt: tieFinishedAt });
    const expectedTieWinner = [tieA.id, tieB.id].sort().reverse()[0]; // greatest id

    // A running batch, started after everything else, must never be selected.
    await repo.insertBatch({ workspaceId: ws, ownerKind: 'agent', ownerId, ownerVersion: 3 });

    const latest = await repo.getLatestTerminalBatch(ws, 'agent', ownerId);
    expect(latest?.id).toBe(expectedTieWinner);
    expect(latest?.status).not.toBe('running');
  });

  // ===========================================================================
  // REQ-31 — batch history ordered started_at desc, id desc
  // ===========================================================================

  it('REQ-31 — history orders started_at desc, id desc', async () => {
    const ws = await freshWorkspace();
    const ownerId = randomUUID();
    const t1 = new Date('2026-03-01T00:00:00Z');
    const t2 = new Date('2026-03-02T00:00:00Z');

    const early = await repo.insertBatch({
      workspaceId: ws,
      ownerKind: 'skill',
      ownerId,
      ownerVersion: 1,
      startedAt: t1,
    });
    // Two batches tied on started_at — id desc breaks the tie.
    const lateA = await repo.insertBatch({
      workspaceId: ws,
      ownerKind: 'skill',
      ownerId,
      ownerVersion: 2,
      startedAt: t2,
    });
    const lateB = await repo.insertBatch({
      workspaceId: ws,
      ownerKind: 'skill',
      ownerId,
      ownerVersion: 2,
      startedAt: t2,
    });
    const expectedLateOrder = [lateA.id, lateB.id].sort().reverse(); // greatest id first

    const history = await repo.listBatchHistory(ws, 'skill', ownerId);
    expect(history.map((b) => b.id)).toEqual([...expectedLateOrder, early.id]);
  });

  // ===========================================================================
  // REQ-37 — trailing-30-day trend read
  // ===========================================================================

  it('REQ-37 — the trend read returns only terminal batches within the trailing 30 days, ascending finished_at, and [] when every batch is older', async () => {
    const ws = await freshWorkspace();
    const ownerId = randomUUID();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const insideOld = await repo.insertBatch({ workspaceId: ws, ownerKind: 'agent', ownerId, ownerVersion: 1 });
    await repo.completeBatch(ws, insideOld.id, {
      status: 'succeeded',
      finishedAt: new Date(now - 20 * day),
    });
    const insideNew = await repo.insertBatch({ workspaceId: ws, ownerKind: 'agent', ownerId, ownerVersion: 2 });
    await repo.completeBatch(ws, insideNew.id, {
      status: 'succeeded',
      finishedAt: new Date(now - 5 * day),
    });
    // Outside the 30-day window — must be excluded, not clamped to the newest-in-window.
    const outside = await repo.insertBatch({ workspaceId: ws, ownerKind: 'agent', ownerId, ownerVersion: 3 });
    await repo.completeBatch(ws, outside.id, {
      status: 'succeeded',
      finishedAt: new Date(now - 40 * day),
    });
    // A running batch (no finished_at) must also be excluded.
    await repo.insertBatch({ workspaceId: ws, ownerKind: 'agent', ownerId, ownerVersion: 4 });

    const trend = await repo.getTrendBatches(ws, 'agent', ownerId, 30);
    expect(trend.map((b) => b.id)).toEqual([insideOld.id, insideNew.id]); // ascending finished_at

    // A second owner whose only batch is outside the window gets [], not the newest row outside it.
    const staleOwnerId = randomUUID();
    const stale = await repo.insertBatch({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId: staleOwnerId,
      ownerVersion: 1,
    });
    await repo.completeBatch(ws, stale.id, { status: 'succeeded', finishedAt: new Date(now - 90 * day) });
    const staleTrend = await repo.getTrendBatches(ws, 'agent', staleOwnerId, 30);
    expect(staleTrend).toEqual([]);
  });

  // ===========================================================================
  // REQ-40 — every read/write takes workspaceId; a two-workspace fixture proves scoping
  // ===========================================================================

  it('REQ-40 — every read and write is scoped by workspaceId; a row in another workspace is never returned', async () => {
    const wsA = await freshWorkspace();
    const wsB = await freshWorkspace();
    const ownerId = randomUUID();

    const caseInA = await repo.insertCase({
      workspaceId: wsA,
      ownerKind: 'agent',
      ownerId,
      name: 'belongs to A',
    });
    const batchInA = await repo.insertBatch({
      workspaceId: wsA,
      ownerKind: 'agent',
      ownerId,
      ownerVersion: 1,
    });
    await repo.completeBatch(wsA, batchInA.id, {
      status: 'succeeded',
      finishedAt: new Date(),
    });

    // Reads from B must not see A's rows, even with the same owner id.
    expect(await repo.getCaseById(wsB, caseInA.id)).toBeUndefined();
    expect(await repo.listCases(wsB, 'agent', ownerId)).toEqual([]);
    expect(await repo.getBatchById(wsB, batchInA.id)).toBeUndefined();
    expect(await repo.listBatchHistory(wsB, 'agent', ownerId)).toEqual([]);
    expect(await repo.getLatestTerminalBatch(wsB, 'agent', ownerId)).toBeUndefined();
    expect(await repo.getTrendBatches(wsB, 'agent', ownerId, 30)).toEqual([]);

    // Writes from B must not touch A's rows.
    const updatedFromB = await repo.updateCase(wsB, caseInA.id, { name: 'hijacked' });
    expect(updatedFromB).toBeUndefined();
    const stillOriginal = await repo.getCaseById(wsA, caseInA.id);
    expect(stillOriginal?.name).toBe('belongs to A');
    const deletedFromB = await repo.deleteCase(wsB, caseInA.id);
    expect(deletedFromB).toBe(false);
    expect(await repo.getCaseById(wsA, caseInA.id)).toBeDefined();

    // A read scoped correctly to A still finds its own rows.
    expect((await repo.getCaseById(wsA, caseInA.id))?.id).toBe(caseInA.id);
    expect((await repo.getBatchById(wsA, batchInA.id))?.id).toBe(batchInA.id);
  });

  // ===========================================================================
  // REQ-69 — deleting the runner agent leaves the skill batch row, nulls runner_agent_id
  // ===========================================================================

  it('REQ-69 — deleting the runner agent leaves the batch row present, runner_agent_id null, runner_agent_version unchanged', async () => {
    const ws = await freshWorkspace();
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: 'runner agent',
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemPrompt: 'review this',
      })
      .returning();
    expect(agent).toBeDefined();

    const batch = await repo.insertBatch({
      workspaceId: ws,
      ownerKind: 'skill',
      ownerId: randomUUID(),
      ownerVersion: 1,
      runnerAgentId: agent!.id,
      runnerAgentVersion: 3,
    });

    // Delete the agent directly (the owning module's job, not this repository's —
    // see the file header's REQ-41 note); the FK's ON DELETE SET NULL does the rest.
    await pg.handle.db.delete(t.agents).where(eq(t.agents.id, agent!.id));

    const after = await repo.getBatchById(ws, batch.id);
    expect(after).toBeDefined();
    expect(after?.runnerAgentId).toBeNull();
    expect(after?.runnerAgentVersion).toBe(3);
  });

  // ===========================================================================
  // REQ-70 — the non-terminal batch referencing a case, or none
  // ===========================================================================

  it('REQ-70 — returns the running batch that already has a run row for the case, or none', async () => {
    const ws = await freshWorkspace();
    const kase = await repo.insertCase({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId: randomUUID(),
      name: 'referenced case',
    });

    // No batch references it yet.
    expect(await repo.getNonTerminalBatchForCase(ws, kase.id)).toBeUndefined();

    const runningBatch = await repo.insertBatch({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId: randomUUID(),
      ownerVersion: 1,
    });
    await repo.insertRun({ caseId: kase.id, batchId: runningBatch.id });

    const found = await repo.getNonTerminalBatchForCase(ws, kase.id);
    expect(found?.id).toBe(runningBatch.id);

    // Once the batch is terminal, it no longer counts as "non-terminal".
    await repo.completeBatch(ws, runningBatch.id, { status: 'succeeded', finishedAt: new Date() });
    expect(await repo.getNonTerminalBatchForCase(ws, kase.id)).toBeUndefined();
  });

  // ===========================================================================
  // Cross-table reads (agents, agent_versions, skills, skill_versions, agent_skills)
  // ===========================================================================

  it('reads agents.system_prompt/model/version/enabled, agent_versions.config_json, skills/skill_versions.body and agent_skills.order', async () => {
    const ws = await freshWorkspace();
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name: 'cross-table agent',
        provider: 'anthropic',
        model: 'claude-sonnet',
        systemPrompt: 'be thorough',
        version: 2,
        enabled: true,
      })
      .returning();
    await pg.handle.db.insert(t.agentVersions).values({
      agentId: agent!.id,
      version: 1,
      configJson: { model: 'claude-old' },
    });

    const [skillA] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: ws,
        name: 'skill a',
        description: 'd',
        type: 'convention',
        source: 'manual',
        body: 'body-a',
      })
      .returning();
    const [skillB] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: ws,
        name: 'skill b',
        description: 'd',
        type: 'convention',
        source: 'manual',
        body: 'body-b',
      })
      .returning();
    await pg.handle.db.insert(t.skillVersions).values({
      skillId: skillA!.id,
      version: 1,
      body: 'body-a-v1',
    });
    await pg.handle.db.insert(t.agentSkills).values([
      { agentId: agent!.id, skillId: skillB!.id, order: 1 },
      { agentId: agent!.id, skillId: skillA!.id, order: 0 },
    ]);

    try {
      const summary = await repo.getAgentSummary(ws, agent!.id);
      expect(summary).toEqual({
        systemPrompt: 'be thorough',
        model: 'claude-sonnet',
        version: 2,
        enabled: true,
      });

      const config = await repo.getAgentVersionConfig(ws, agent!.id, 1);
      expect(config).toEqual({ model: 'claude-old' });

      expect(await repo.getSkillSummary(ws, skillA!.id)).toEqual({ version: 1, body: 'body-a' });
      expect(await repo.getSkillVersionBody(skillA!.id, 1)).toBe('body-a-v1');

      const order = await repo.listAgentSkillsOrder(agent!.id);
      expect(order).toEqual([
        { skillId: skillA!.id, order: 0 },
        { skillId: skillB!.id, order: 1 },
      ]);
    } finally {
      // Explicit cleanup: agents, skills and agent_skills links are workspace-
      // scoped state that outlives a fresh workspace only within this Postgres
      // container — delete what this test seeded before it closes.
      await pg.handle.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agent!.id));
      await pg.handle.db.delete(t.skillVersions).where(eq(t.skillVersions.skillId, skillA!.id));
      await pg.handle.db.delete(t.skills).where(eq(t.skills.workspaceId, ws));
      await pg.handle.db.delete(t.agentVersions).where(eq(t.agentVersions.agentId, agent!.id));
      await pg.handle.db.delete(t.agents).where(eq(t.agents.id, agent!.id));
    }
  });
  // ===========================================================================
  // ===========================================================================
  // insertCompletedBatch — the batch of 1 a single-case run persists
  // ===========================================================================

  it('insertCompletedBatch writes a row that is terminal from the INSERT — never observable as running', async () => {
    const ws = await freshWorkspace();
    const ownerId = randomUUID();
    const finishedAt = new Date('2026-03-02T10:00:00Z');

    const batch = await repo.insertCompletedBatch({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId,
      ownerVersion: 7,
      status: 'succeeded',
      finishedAt,
      casesTotal: 1,
      casesPassed: 1,
      recall: 1,
      precision: null,
      citationAccuracy: 0.5,
      costUsd: 0.25,
    });

    expect(batch.status).toBe('succeeded');
    expect(batch.finishedAt?.toISOString()).toBe(finishedAt.toISOString());
    expect(batch.casesTotal).toBe(1);
    // `null` survives the round-trip as `null`, never coalesced to 0. The
    // repository stores what it is handed — the vacuous-truth rule that turns
    // a zero denominator into 1 lives in `scoring.ts`, above this layer.
    expect(batch.precision).toBeNull();
    expect(batch.recall).toBe(1);
    expect(batch.costUsd).toBe(0.25);

    // The property the whole design rests on: it is terminal immediately, so
    // REQ-14's live-batch lookup — which scans `listBatchHistory` for a
    // `running` row — can never see it, and the owner's batch lock is never
    // taken by a single-case run.
    const history = await repo.listBatchHistory(ws, 'agent', ownerId);
    expect(history.every((b) => b.status !== 'running')).toBe(true);
    // ...and REQ-30 picks it up as a real terminal batch.
    expect((await repo.getLatestTerminalBatch(ws, 'agent', ownerId))?.id).toBe(batch.id);
  });

  it('listBatchHistory caps at `limit` when given one, newest first — the dashboard payload bound', async () => {
    const ws = await freshWorkspace();
    const ownerId = randomUUID();
    for (let i = 0; i < 4; i += 1) {
      await repo.insertCompletedBatch({
        workspaceId: ws,
        ownerKind: 'agent',
        ownerId,
        ownerVersion: i,
        status: 'succeeded',
        startedAt: new Date(Date.UTC(2026, 2, 1 + i)),
        finishedAt: new Date(Date.UTC(2026, 2, 1 + i)),
        casesTotal: 1,
        casesPassed: 1,
      });
    }

    expect(await repo.listBatchHistory(ws, 'agent', ownerId)).toHaveLength(4);
    const capped = await repo.listBatchHistory(ws, 'agent', ownerId, 2);
    expect(capped).toHaveLength(2);
    expect(capped.map((b) => b.ownerVersion)).toEqual([3, 2]);
  });

  // Boot-time orphan sweep. LAST in the file on purpose: unlike every other
  // test here it is NOT workspace-scoped — the reaper sweeps every `running`
  // batch in the database, exactly as `reapStaleRunningRuns` does for
  // `agent_runs`, because a freshly booted process owns none of them. Running
  // it earlier would flip another test's deliberately-running batch.
  // ===========================================================================

  it('reaps every batch left running — a crashed process cannot resume one — and leaves terminal batches alone', async () => {
    const ws = await freshWorkspace();
    const ownerId = randomUUID();
    const orphan = await repo.insertBatch({ workspaceId: ws, ownerKind: 'agent', ownerId, ownerVersion: 1 });
    const finished = await repo.insertBatch({ workspaceId: ws, ownerKind: 'agent', ownerId, ownerVersion: 1 });
    const finishedAt = new Date('2026-01-01T00:00:00Z');
    await repo.completeBatch(ws, finished.id, { status: 'succeeded', finishedAt, casesTotal: 2, casesPassed: 2 });

    const reaped = await repo.reapStaleRunningBatches();
    expect(reaped).toBeGreaterThanOrEqual(1);

    const swept = await repo.getBatchById(ws, orphan.id);
    expect(swept?.status).toBe('failed');
    // A stranded batch with no `finished_at` still reads as in-flight to any
    // query that sorts on it (REQ-30's "latest terminal batch"), so the sweep
    // must stamp one.
    expect(swept?.finishedAt).not.toBeNull();

    const untouched = await repo.getBatchById(ws, finished.id);
    expect(untouched?.status).toBe('succeeded');
    expect(untouched?.finishedAt?.toISOString()).toBe(finishedAt.toISOString());

    // A single-case run's batch of 1 is inserted already terminal, so the
    // sweep cannot touch it either — which is precisely what stops a restart
    // mid-run from manufacturing a phantom `0/1` row on the dashboard.
    const solo = await repo.insertCompletedBatch({
      workspaceId: ws,
      ownerKind: 'agent',
      ownerId,
      ownerVersion: 1,
      status: 'succeeded',
      casesTotal: 1,
      casesPassed: 1,
    });
    await repo.reapStaleRunningBatches();
    expect((await repo.getBatchById(ws, solo.id))?.status).toBe('succeeded');

    // Idempotent: nothing is left running, so a second boot sweeps nothing.
    expect(await repo.reapStaleRunningBatches()).toBe(0);
  });
});
