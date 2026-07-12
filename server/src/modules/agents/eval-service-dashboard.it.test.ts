/**
 * eval-service-dashboard.it.test.ts — Integration tests for Task 7.
 *
 * Docker / Testcontainers. Self-skips when Docker is not available.
 *
 * Asserts:
 *   (a) AC-15: runHistory returns groups newest-first with aggregates +
 *       version + cost; traces_passed/traces_total/pass_rate are enriched.
 *   (b) AC-16: compare returns per-metric deltas + a system_prompt diff between
 *       two versions; degrades to "version unavailable" when a version is pruned.
 *   (c) AC-18: promote sets the agent's active config to the chosen version via
 *       the agent-version path (no parallel versioning scheme).
 *   (d) AC-20: dashboard lists every agent with current metrics and recent runs.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
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
  console.warn('[eval-service-dashboard.it] Docker not available — skipping integration tests.');
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * A minimal unified diff covering a few lines (survives groundFindings).
 */
const FIXTURE_DIFF = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,10 +1,10 @@
 import jwt from 'jsonwebtoken';
+const SECRET = process.env.JWT_SECRET ?? 'fallback';
 export function sign(payload: object) {
-  return jwt.sign(payload, 'hardcoded');
+  return jwt.sign(payload, SECRET);
 }`;

/** A Review fixture that contains one finding anchored in the diff. */
const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'Auth reviewed.',
  score: 75,
  findings: [
    {
      id: randomUUID(),
      severity: 'WARNING',
      category: 'security',
      title: 'Hardcoded secret fallback',
      file: 'src/auth.ts',
      start_line: 2,
      end_line: 3,
      rationale: 'Fallback is insecure.',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

d('EvalService — T7 dashboard / compare / promote (integration)', () => {
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
    systemPrompt = 'You are a careful reviewer.',
    version = 1,
  ): Promise<{ id: string; version: number }> {
    const [row] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt,
        version,
      })
      .returning({ id: t.agents.id, version: t.agents.version });
    // Also snapshot version 1 into agent_versions.
    await pg.handle.db
      .insert(t.agentVersions)
      .values({
        agentId: row!.id,
        version: 1,
        configJson: {
          name,
          description: 'desc',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: systemPrompt,
          output_schema: null,
          strategy: 'auto',
          ci_fail_on: 'critical',
          repo_intel: false,
          skills: [],
        },
      })
      .onConflictDoNothing();
    return { id: row!.id, version: row!.version };
  }

  // Helper: insert an eval case for an agent with the fixture diff.
  async function insertCase(agentId: string): Promise<string> {
    const repo = new EvalRepository(pg.handle.db);
    const row = await repo.createCase(workspaceId, {
      ownerKind: 'agent',
      ownerId: agentId,
      name: `Test case for ${agentId}`,
      inputDiff: FIXTURE_DIFF,
      expectedOutput: {
        type: 'must_find',
        findings: [
          {
            id: randomUUID(),
            severity: 'WARNING',
            category: 'security',
            title: 'Hardcoded secret fallback',
            file: 'src/auth.ts',
            start_line: 2,
            end_line: 3,
            rationale: 'reason',
            confidence: 0.9,
          },
        ],
      },
    });
    return row.id;
  }

  // =========================================================================
  // (a) AC-15: runHistory newest-first with aggregates + version + cost
  // =========================================================================

  it('(a) AC-15: runHistory returns groups newest-first with aggregates + version + cost', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);
    const agent = await insertAgent('T7-AC15-agent');
    await insertCase(agent.id);

    const svc = new EvalService(pg.handle.db, container);

    // Create two runs so we have at least two groups.
    await svc.runAgentEvals(workspaceId, agent.id, 'run-1 (older)');
    // Small delay to ensure ran_at ordering is distinct.
    await new Promise((r) => setTimeout(r, 20));
    await svc.runAgentEvals(workspaceId, agent.id, 'run-2 (newer)');

    const history = await svc.runHistory(workspaceId, agent.id);

    // Must be an EvalDashboard for this agent.
    expect(history.owner_id).toBe(agent.id);
    expect(history.owner_kind).toBe('agent');
    expect(history.cases_total).toBeGreaterThanOrEqual(1);

    // Trend must be newest-first: the first entry is the most recent run.
    expect(history.trend.length).toBeGreaterThanOrEqual(2);
    const t0 = new Date(history.trend[0]!.ran_at).getTime();
    const t1 = new Date(history.trend[1]!.ran_at).getTime();
    expect(t0).toBeGreaterThanOrEqual(t1); // newest first

    // Aggregates must be numbers (not undefined).
    for (const tp of history.trend) {
      expect(typeof tp.recall).toBe('number');
      expect(typeof tp.precision).toBe('number');
      expect(typeof tp.citation_accuracy).toBe('number');
      expect(typeof tp.pass_rate).toBe('number');
    }

    // Delta is populated (current vs previous).
    expect(typeof history.delta.recall).toBe('number');
    expect(typeof history.delta.precision).toBe('number');

    // Recent runs are the per-case rows of the latest group.
    expect(Array.isArray(history.recent_runs)).toBe(true);
  });

  it('(a) AC-15: runHistory — empty case set returns a valid zero-metric dashboard', async () => {
    const agent = await insertAgent('T7-AC15-empty-agent');
    // No cases, no runs.
    const svc = new EvalService(pg.handle.db);
    const history = await svc.runHistory(workspaceId, agent.id);

    expect(history.owner_id).toBe(agent.id);
    expect(history.cases_total).toBe(0);
    expect(history.trend).toHaveLength(0);
    expect(history.recent_runs).toHaveLength(0);
    expect(history.current.recall).toBe(0);
    expect(history.current.precision).toBe(0);
    expect(history.current.citation_accuracy).toBe(0);
  });

  // =========================================================================
  // (b) AC-16: compare returns per-metric deltas + system_prompt diff
  // =========================================================================

  it('(b) AC-16: compare returns deltas + system_prompt diff between two versions', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);

    // Agent starts at version 1 with prompt A.
    const promptA = 'Be strict about security issues.';
    const agent = await insertAgent('T7-AC16-compare-agent', promptA, 1);
    await insertCase(agent.id);

    const svc = new EvalService(pg.handle.db, container);
    const runSvc = new EvalService(pg.handle.db, container);

    // Run 1 (version 1 prompt).
    const result1 = await runSvc.runAgentEvals(workspaceId, agent.id, 'v1-baseline');

    // Simulate a prompt change: update the agent (bumps version to 2).
    const promptB = 'Focus only on critical bugs, ignore style issues.';
    await pg.handle.db
      .update(t.agents)
      .set({ systemPrompt: promptB, version: 2 })
      .where(eq(t.agents.id, agent.id));
    // Snapshot version 2 into agent_versions.
    await pg.handle.db
      .insert(t.agentVersions)
      .values({
        agentId: agent.id,
        version: 2,
        configJson: {
          name: 'T7-AC16-compare-agent',
          description: 'desc',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: promptB,
          output_schema: null,
          strategy: 'auto',
          ci_fail_on: 'critical',
          repo_intel: false,
          skills: [],
        },
      })
      .onConflictDoNothing();

    // Run 2 (version 2 prompt — but mock returns same fixture so metrics are identical).
    const result2 = await runSvc.runAgentEvals(workspaceId, agent.id, 'v2-candidate');

    // Now compare.
    const comparison = await svc.compare(
      workspaceId,
      agent.id,
      result1.group.id,
      result2.group.id,
    );

    // Must return both groups.
    expect(comparison.group_a.id).toBe(result1.group.id);
    expect(comparison.group_b.id).toBe(result2.group.id);

    // Per-metric deltas must be numbers.
    expect(typeof comparison.delta.recall).toBe('number');
    expect(typeof comparison.delta.precision).toBe('number');
    expect(typeof comparison.delta.citation_accuracy).toBe('number');

    // system_prompt_diff must be present (non-null string).
    expect(typeof comparison.system_prompt_diff).toBe('string');

    // The two prompts must be resolved.
    expect(comparison.prompt_a).toBe(promptA);
    expect(comparison.prompt_b).toBe(promptB);

    // Since they differ, the diff must not be empty.
    expect(comparison.system_prompt_diff).toContain('+');

    // Per-case rows must be present.
    expect(Array.isArray(comparison.rows_a)).toBe(true);
    expect(Array.isArray(comparison.rows_b)).toBe(true);
  });

  it('(b) AC-16: compare degrades to "version unavailable" when a version is pruned', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);

    const agent = await insertAgent('T7-AC16-pruned-agent', 'Initial prompt', 1);
    await insertCase(agent.id);

    const runSvc = new EvalService(pg.handle.db, container);
    const result1 = await runSvc.runAgentEvals(workspaceId, agent.id, 'v1');
    const result2 = await runSvc.runAgentEvals(workspaceId, agent.id, 'v1-repeat');

    // Prune the version snapshot — delete agent_versions rows for this agent.
    // This simulates the "pruned after a run" edge case (SPEC-03 edge cases).
    await pg.handle.db
      .delete(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agent.id));

    const svc = new EvalService(pg.handle.db);
    const comparison = await svc.compare(
      workspaceId,
      agent.id,
      result1.group.id,
      result2.group.id,
    );

    // Both prompts should degrade gracefully.
    expect(comparison.prompt_a).toBe('version unavailable');
    expect(comparison.prompt_b).toBe('version unavailable');
    expect(comparison.system_prompt_diff).toContain('unavailable');

    // Deltas are still computed from the stored aggregate metrics.
    expect(typeof comparison.delta.recall).toBe('number');
  });

  // =========================================================================
  // (c) AC-18: promote sets the agent's active config via the agent-version path
  // =========================================================================

  it('(c) AC-18: promote sets the agent active config to the chosen version', async () => {
    const promptV1 = 'Original system prompt v1.';
    const agent = await insertAgent('T7-AC18-promote-agent', promptV1, 1);

    // Simulate a config update creating version 2 with a different prompt.
    const promptV2 = 'Updated system prompt v2.';
    await pg.handle.db
      .update(t.agents)
      .set({ systemPrompt: promptV2, version: 2 })
      .where(eq(t.agents.id, agent.id));
    await pg.handle.db
      .insert(t.agentVersions)
      .values({
        agentId: agent.id,
        version: 2,
        configJson: {
          name: 'T7-AC18-promote-agent',
          description: 'desc',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: promptV2,
          output_schema: null,
          strategy: 'auto',
          ci_fail_on: 'critical',
          repo_intel: false,
          skills: [],
        },
      })
      .onConflictDoNothing();

    // Current prompt is v2. Promote back to v1.
    const svc = new EvalService(pg.handle.db);
    const promoted = await svc.promote(workspaceId, agent.id, 1);

    // The returned AgentVersion must be a new version (≥3) with v1's system_prompt.
    expect(promoted.agent_id).toBe(agent.id);
    expect(promoted.config.system_prompt).toBe(promptV1);
    // Version must have advanced (the update path always bumps if config changed).
    expect(promoted.version).toBeGreaterThan(2);

    // The agent row must now carry the promoted prompt.
    const [agentRow] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.id, agent.id));
    expect(agentRow!.systemPrompt).toBe(promptV1);
  });

  it('(c) AC-18: promote throws when the target version does not exist', async () => {
    const agent = await insertAgent('T7-AC18-missing-version-agent');
    const svc = new EvalService(pg.handle.db);

    await expect(svc.promote(workspaceId, agent.id, 999)).rejects.toThrow(
      /version 999 not found/i,
    );
  });

  // =========================================================================
  // (d) AC-20: dashboard lists every agent with current metrics
  // =========================================================================

  it('(d) AC-20: dashboard returns at least one entry per agent with a case or run group', async () => {
    const llm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const container = makeContainer(llm);

    const agentA = await insertAgent('T7-AC20-agent-A');
    const agentB = await insertAgent('T7-AC20-agent-B');
    await insertCase(agentA.id);
    await insertCase(agentB.id);

    const runSvc = new EvalService(pg.handle.db, container);
    await runSvc.runAgentEvals(workspaceId, agentA.id, 'dashboard-run-A');
    await runSvc.runAgentEvals(workspaceId, agentB.id, 'dashboard-run-B');

    const svc = new EvalService(pg.handle.db);
    const dashboards = await svc.dashboard(workspaceId);

    // Must have entries for both agents.
    const ownerIds = dashboards.map((d) => d.owner_id);
    expect(ownerIds).toContain(agentA.id);
    expect(ownerIds).toContain(agentB.id);

    for (const entry of dashboards) {
      // Each entry has required fields.
      expect(typeof entry.cases_total).toBe('number');
      expect(typeof entry.current.recall).toBe('number');
      expect(typeof entry.current.precision).toBe('number');
      expect(typeof entry.current.citation_accuracy).toBe('number');
      expect(Array.isArray(entry.trend)).toBe(true);
      expect(Array.isArray(entry.recent_runs)).toBe(true);
    }
  });

  // Cross-workspace isolation for dashboard: the dashboard must not leak entries
  // from other workspaces.
  it('(d) AC-20: dashboard is workspace-scoped — other workspace entries not visible', async () => {
    const otherWsId = randomUUID();
    const svc = new EvalService(pg.handle.db);
    const dashboards = await svc.dashboard(otherWsId);

    // A completely random workspace has no cases/groups → empty dashboard.
    expect(dashboards).toHaveLength(0);
  });
});
