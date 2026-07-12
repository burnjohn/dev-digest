/**
 * eval-service-run.it.test.ts — Integration tests for Task 6 run orchestrator.
 *
 * Docker / Testcontainers. Self-skips when Docker is not available.
 *
 * Asserts:
 *   (a) A run replays each case's stored `inputDiff` (no live-PR fetch) and
 *       records the agent's current version (AC-6/7).
 *   (b) A run group + one `eval_runs` row per case are persisted with
 *       metrics + cost (AC-13).
 *   (c) The scoring path makes ZERO provider calls beyond the per-case review;
 *       provider call count == number of cases (AC-11).
 *   (d) Two overlapping runs write distinct groups (edge case — D1).
 *   (e) A case with a malformed `expectedOutput` fails only its row, not the
 *       whole run (edge case).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Review } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { MockLLMProvider, MockSecretsProvider, MockAuthProvider } from '../../adapters/mocks.js';
import { EvalService } from './eval-service.js';
import { EvalRepository } from './eval-repository.js';
import { Container } from '../../platform/container.js';
import { loadConfig } from '../../platform/config.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-service-run.it] Docker not available — skipping integration tests.');
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * A minimal unified diff fixture covering lines 1–20 of src/index.ts.
 * Used as `inputDiff` in eval cases. The diff is structured so that a
 * finding at `src/index.ts:10` will survive `groundFindings`.
 */
const FIXTURE_DIFF = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,20 +1,20 @@
 import express from 'express';
+import rateLimit from 'express-rate-limit';
 const app = express();
+app.use(rateLimit({ max: 100 }));
 app.listen(3000);`;

/**
 * A Review fixture returned by MockLLMProvider that contains one finding
 * anchored at src/index.ts:10 (inside the FIXTURE_DIFF hunk — survives grounding).
 */
const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'Rate-limit middleware looks good.',
  score: 80,
  findings: [
    {
      id: randomUUID(),
      severity: 'WARNING',
      category: 'security',
      title: 'Rate limit is low',
      file: 'src/index.ts',
      start_line: 3,
      end_line: 4,
      rationale: 'The limit of 100 requests per window may be insufficient.',
      confidence: 0.8,
      kind: 'finding',
    },
  ],
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

d('EvalService.runAgentEvals — integration (T6 run orchestrator)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId: wsId } = await seed(pg.handle.db);
    workspaceId = wsId;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  // -------------------------------------------------------------------------
  // Helper: build a Container with a MockLLMProvider injected for 'openai'.
  // -------------------------------------------------------------------------

  function makeContainer(llm: MockLLMProvider): Container {
    // We need a real config but can use a dummy secrets provider (no real keys).
    const config = loadConfig();
    return new Container(config, pg.handle.db, {
      secrets: new MockSecretsProvider({}),
      auth: new MockAuthProvider(
        { id: 'u1', email: 'test@test.com', name: 'Test' },
        { id: workspaceId, name: 'default' },
      ),
      llm: { openai: llm },
    });
  }

  // Helper: insert an agent row and return its id + version.
  async function insertAgent(
    name: string,
    provider: 'openai' | 'anthropic' | 'openrouter' = 'openai',
    version = 1,
  ): Promise<{ id: string; version: number }> {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name,
        provider,
        model: 'gpt-4.1',
        systemPrompt: 'You are a reviewer.',
        version,
      })
      .returning({ id: t.agents.id, version: t.agents.version });
    return { id: row!.id, version: row!.version };
  }

  // Helper: insert an eval case for an agent with the fixture diff.
  async function insertCase(
    agentId: string,
    expectedOutput: unknown = {
      type: 'must_find',
      findings: [
        {
          id: randomUUID(),
          severity: 'WARNING',
          category: 'security',
          title: 'Rate limit is low',
          file: 'src/index.ts',
          start_line: 3,
          end_line: 4,
          rationale: 'reason',
          confidence: 0.8,
        },
      ],
    },
    inputDiff: string = FIXTURE_DIFF,
  ): Promise<string> {
    const repo = new EvalRepository(pg.handle.db);
    const row = await repo.createCase(workspaceId, {
      ownerKind: 'agent',
      ownerId: agentId,
      name: `Test case for ${agentId}`,
      inputDiff,
      expectedOutput,
    });
    return row.id;
  }

  // -------------------------------------------------------------------------
  // (a) AC-6/7: frozen inputDiff replayed verbatim; agent version recorded.
  // -------------------------------------------------------------------------

  it('(a) records the agent version on the run group (AC-7)', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);
    const agent = await insertAgent('T6-AC7-agent', 'openai', 3);
    await insertCase(agent.id);

    const svc = new EvalService(pg.handle.db, container);
    const result = await svc.runAgentEvals(workspaceId, agent.id);

    // The run group must record the agent's current version (version = 3).
    expect(result.group.agent_version).toBe(3);
    expect(result.group.owner_id).toBe(agent.id);
    expect(result.group.owner_kind).toBe('agent');
    expect(result.group.workspace_id).toBe(workspaceId);
  });

  it('(a) AC-6: uses stored inputDiff — provider is called (exactly once) per case, not for live data', async () => {
    // The mock provider tracks every structured call. If the service re-fetched
    // the live PR it would either throw (no GitHub adapter) or call a GitHub mock.
    // Since we inject only `llm`, ANY GitHub fetch would panic — proving that
    // the only calls are the review calls (one per case).
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);
    const agent = await insertAgent('T6-AC6-agent', 'openai');
    await insertCase(agent.id);
    await insertCase(agent.id); // 2 cases

    const svc = new EvalService(pg.handle.db, container);
    const result = await svc.runAgentEvals(workspaceId, agent.id);

    // Two cases → 2 results, 2 review calls (one per case).
    expect(result.results).toHaveLength(2);
    const reviewCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(reviewCalls).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // (b) AC-13: run group + one eval_runs row per case with metrics + cost.
  // -------------------------------------------------------------------------

  it('(b) AC-13: persists a run group + one eval_runs row per case', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);
    const agent = await insertAgent('T6-AC13-agent', 'openai');

    // Create 3 cases.
    const caseIds = await Promise.all([
      insertCase(agent.id),
      insertCase(agent.id),
      insertCase(agent.id),
    ]);

    const svc = new EvalService(pg.handle.db, container);
    const result = await svc.runAgentEvals(workspaceId, agent.id, 'v1 — baseline');

    // One result per case.
    expect(result.results).toHaveLength(3);
    for (const caseId of caseIds) {
      const found = result.results.find((r) => r.case_id === caseId);
      expect(found).toBeTruthy();
      expect(found!.run_id).toBeTruthy(); // persisted row has an id
    }

    // The group aggregate must be present.
    expect(result.group.id).toBeTruthy();
    expect(result.group.label).toBe('v1 — baseline');
    expect(typeof result.group.recall).toBe('number');
    expect(typeof result.group.precision).toBe('number');
    expect(typeof result.group.citation_accuracy).toBe('number');

    // Verify rows are in the DB.
    const repo = new EvalRepository(pg.handle.db);
    const rows = await repo.runRowsForGroup(result.group.id);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.id).toBeTruthy();
      expect(row.run_group_id).toBe(result.group.id);
      expect(row.pass).toBeDefined();
      expect(typeof row.recall).toBe('number');
      expect(typeof row.precision).toBe('number');
      expect(typeof row.citation_accuracy).toBe('number');
    }
  });

  // -------------------------------------------------------------------------
  // (c) AC-11: scoring makes ZERO additional LLM calls beyond the per-case review.
  //     Total provider calls == number of cases (one review call each).
  // -------------------------------------------------------------------------

  it('(c) AC-11: provider call count == number of cases (scoring adds zero calls)', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);
    const agent = await insertAgent('T6-AC11-agent', 'openai');

    const N_CASES = 4;
    for (let i = 0; i < N_CASES; i++) {
      await insertCase(agent.id);
    }

    const svc = new EvalService(pg.handle.db, container);
    await svc.runAgentEvals(workspaceId, agent.id);

    // Every completeStructured call is a review call. Scoring is pure code.
    const reviewCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(reviewCalls).toHaveLength(N_CASES);

    // No `complete` or other provider calls.
    const otherCalls = llm.calls.filter((c) => c.method !== 'completeStructured');
    expect(otherCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // (d) Two overlapping runs write DISTINCT groups (edge case — concurrency, D1).
  // -------------------------------------------------------------------------

  it('(d) two concurrent runs write distinct groups with distinct ids', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);
    const agent = await insertAgent('T6-distinct-groups-agent', 'openai');
    await insertCase(agent.id);

    const svc = new EvalService(pg.handle.db, container);

    // Run both simultaneously (Promise.all — overlapping).
    const [result1, result2] = await Promise.all([
      svc.runAgentEvals(workspaceId, agent.id, 'run-A'),
      svc.runAgentEvals(workspaceId, agent.id, 'run-B'),
    ]);

    // Must produce DISTINCT group ids.
    expect(result1.group.id).toBeTruthy();
    expect(result2.group.id).toBeTruthy();
    expect(result1.group.id).not.toBe(result2.group.id);

    // Each group should have its own per-case row.
    const repo = new EvalRepository(pg.handle.db);
    const rows1 = await repo.runRowsForGroup(result1.group.id);
    const rows2 = await repo.runRowsForGroup(result2.group.id);
    expect(rows1).toHaveLength(1);
    expect(rows2).toHaveLength(1);

    // No row interleaving: rows of group 1 all point to group 1.
    for (const row of rows1) expect(row.run_group_id).toBe(result1.group.id);
    for (const row of rows2) expect(row.run_group_id).toBe(result2.group.id);
  });

  // -------------------------------------------------------------------------
  // (e) Malformed expectedOutput fails only that case row, not the whole run.
  // -------------------------------------------------------------------------

  it('(e) malformed expectedOutput fails only its case row, not the whole run', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);
    const agent = await insertAgent('T6-malformed-agent', 'openai');

    // Case 1: valid must_find case.
    const validCaseId = await insertCase(agent.id);

    // Case 2: malformed expectedOutput (will fail EvalExpectedOutput.safeParse).
    const malformedCaseId = await insertCase(
      agent.id,
      { type: 'unknown_broken_type', random_junk: true }, // does not parse
    );

    const svc = new EvalService(pg.handle.db, container);
    const result = await svc.runAgentEvals(workspaceId, agent.id);

    // The run must COMPLETE (not throw).
    expect(result.results).toHaveLength(2);

    // Valid case must have a result.
    const validResult = result.results.find((r) => r.case_id === validCaseId);
    expect(validResult).toBeTruthy();

    // Malformed case must also have a result row (fail-only-the-case isolation).
    const malformedResult = result.results.find((r) => r.case_id === malformedCaseId);
    expect(malformedResult).toBeTruthy();
    // The malformed case must have failed (traces_passed = 0, all metrics = 0).
    expect(malformedResult!.result.traces_passed).toBe(0);

    // Verify the run group persisted despite the malformed case.
    expect(result.group.id).toBeTruthy();
    const repo = new EvalRepository(pg.handle.db);
    const rows = await repo.runRowsForGroup(result.group.id);
    expect(rows).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Empty case set: run produces an empty result (no throw).
  // -------------------------------------------------------------------------

  it('empty case set: runAgentEvals succeeds with empty results', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);
    const agent = await insertAgent('T6-empty-agent', 'openai');
    // No cases inserted.

    const svc = new EvalService(pg.handle.db, container);
    const result = await svc.runAgentEvals(workspaceId, agent.id);

    expect(result.results).toHaveLength(0);
    expect(result.group.id).toBeTruthy();

    // Vacuous aggregate metrics = 1 (AC-9/10/12 vacuous rule via scoreRun([]) → 1).
    expect(result.group.recall).toBe(1);
    expect(result.group.precision).toBe(1);
    expect(result.group.citation_accuracy).toBe(1);

    // No provider calls were made (no cases to review).
    expect(llm.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // runAllAgents: runs each enabled agent over its own case set.
  // -------------------------------------------------------------------------

  it('runAllAgents: runs each enabled agent and returns one result per agent', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);

    // Create two enabled agents with their own cases.
    const agentA = await insertAgent('T6-all-agent-A', 'openai');
    const agentB = await insertAgent('T6-all-agent-B', 'openai');
    await insertCase(agentA.id);
    await insertCase(agentA.id);
    await insertCase(agentB.id);

    const svc = new EvalService(pg.handle.db, container);
    const results = await svc.runAllAgents(workspaceId);

    // Must include results for agentA and agentB (and possibly others from seed).
    const ids = results.map((r) => r.group.owner_id);
    expect(ids).toContain(agentA.id);
    expect(ids).toContain(agentB.id);

    // agentA result should have 2 case rows; agentB should have 1.
    const aResult = results.find((r) => r.group.owner_id === agentA.id);
    const bResult = results.find((r) => r.group.owner_id === agentB.id);
    expect(aResult!.results).toHaveLength(2);
    expect(bResult!.results).toHaveLength(1);
  });
});
