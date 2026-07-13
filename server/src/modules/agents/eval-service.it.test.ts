/**
 * Eval service — integration tests (Docker / Testcontainers).
 *
 * Verifies Task 5 acceptance criteria:
 *   AC-1: accepted finding → `must_find` case with finding's file+range.
 *   AC-2: dismissed finding → `must_not_flag` case with the forbidden target.
 *   AC-5: list returns ≥8 cases.
 *   Cross-workspace isolation: another workspace's agent cannot see the cases.
 *
 * Also verifies the A-gap fix:
 *   One-click cases with a pullRequestId but no inputDiff must store a
 *   NON-EMPTY inputDiff derived from the PR's stored pr_files patches (AC-6).
 *
 * Self-skips when Docker is not available.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { EvalService } from './eval-service.js';
import type { Finding } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-service.it] Docker not available — skipping integration tests.');
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * A minimal Finding fixture for tests (AC-1/2).
 * Intentionally complete: all required fields from the Finding Zod schema.
 */
function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: randomUUID(),
    severity: 'WARNING',
    category: 'bug',
    title: 'Potential null dereference',
    file: 'src/index.ts',
    start_line: 10,
    end_line: 14,
    rationale: 'The value may be null at this point.',
    confidence: 0.8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

d('EvalService — integration (case CRUD via service)', () => {
  let pg: PgFixture;
  let svc: EvalService;
  let workspaceId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    const { workspaceId: wsId } = await seed(pg.handle.db);
    workspaceId = wsId;
    svc = new EvalService(pg.handle.db);

    // Insert a minimal agent row to use as ownerId.
    const [agent] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'Eval Service Test Agent',
        provider: 'openrouter',
        model: 'test/model',
        systemPrompt: 'You are a reviewer.',
        version: 1,
      })
      .returning({ id: t.agents.id });
    agentId = agent!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  // ---- AC-1: accepted finding → must_find case ----------------------------

  it('AC-1: accept → must_find case with the finding file+range', async () => {
    const finding = makeFinding({ file: 'src/auth.ts', start_line: 20, end_line: 25 });

    const row = await svc.createCaseFromFinding(
      workspaceId,
      agentId,
      finding,
      'accept',
      '--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -18,8 +18,8 @@',
    );

    expect(row.id).toBeTruthy();
    expect(row.workspaceId).toBe(workspaceId);
    expect(row.ownerKind).toBe('agent');
    expect(row.ownerId).toBe(agentId);

    // The expectedOutput must encode a must_find expectation.
    const expected = row.expectedOutput as {
      type: string;
      findings: Finding[];
    };
    expect(expected.type).toBe('must_find');
    expect(Array.isArray(expected.findings)).toBe(true);
    expect(expected.findings).toHaveLength(1);

    const ef = expected.findings[0]!;
    expect(ef.file).toBe('src/auth.ts');
    expect(ef.start_line).toBe(20);
    expect(ef.end_line).toBe(25);
  });

  // ---- AC-2: dismissed finding → must_not_flag case -----------------------

  it('AC-2: dismiss → must_not_flag case with the forbidden target', async () => {
    const finding = makeFinding({ file: 'src/db.ts', start_line: 42, end_line: 44 });

    const row = await svc.createCaseFromFinding(
      workspaceId,
      agentId,
      finding,
      'dismiss',
      '--- a/src/db.ts\n+++ b/src/db.ts\n@@ -40,6 +40,6 @@',
    );

    expect(row.id).toBeTruthy();
    expect(row.ownerKind).toBe('agent');
    expect(row.ownerId).toBe(agentId);

    // The expectedOutput must encode a must_not_flag expectation.
    const expected = row.expectedOutput as {
      type: string;
      findings: Finding[];
      forbidden: Array<{ file: string; start_line: number; end_line: number }>;
    };
    expect(expected.type).toBe('must_not_flag');
    // findings is explicitly empty (AC-2 / D3 discriminated union).
    expect(expected.findings).toHaveLength(0);
    // forbidden must contain exactly the file+range of the dismissed finding.
    expect(Array.isArray(expected.forbidden)).toBe(true);
    expect(expected.forbidden).toHaveLength(1);
    const f = expected.forbidden[0]!;
    expect(f.file).toBe('src/db.ts');
    expect(f.start_line).toBe(42);
    expect(f.end_line).toBe(44);
  });

  // ---- createCase (manual / free-form path) --------------------------------

  it('createCase: manual EvalCaseInput path creates a case row', async () => {
    const row = await svc.createCase(workspaceId, {
      owner_kind: 'agent',
      owner_id: agentId,
      name: 'Manual eval case',
      input_diff: 'diff --git a/x.ts b/x.ts\n+const y = 1;',
      input_files: null,
      input_meta: null,
      expected_output: {
        type: 'must_find',
        findings: [makeFinding()],
      },
      notes: 'Created via manual path',
    });

    expect(row.id).toBeTruthy();
    expect(row.name).toBe('Manual eval case');
    expect(row.notes).toBe('Created via manual path');
  });

  // ---- AC-5: list returns ≥8 cases ----------------------------------------

  it('AC-5: listCases returns ≥8 cases after creating 10', async () => {
    // Use a dedicated agent to avoid interference with other tests.
    const [agent10] = await pg.handle.db
      .insert(t.agents)
      .values({
        workspaceId,
        name: 'AC-5 ten-case agent',
        provider: 'openrouter',
        model: 'test/model',
        systemPrompt: 'reviewer',
        version: 1,
      })
      .returning({ id: t.agents.id });
    const agent10Id = agent10!.id;
    const svc10 = new EvalService(pg.handle.db);

    // Create 10 cases (mix of accept and dismiss).
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => {
        const finding = makeFinding({ file: `src/file${i}.ts`, start_line: i + 1, end_line: i + 2 });
        return svc10.createCaseFromFinding(
          workspaceId,
          agent10Id,
          finding,
          i % 2 === 0 ? 'accept' : 'dismiss',
        );
      }),
    );

    const listed = await svc10.listCases(workspaceId, agent10Id);
    expect(listed.length).toBeGreaterThanOrEqual(8);
    expect(listed.every((r) => r.ownerId === agent10Id)).toBe(true);
  });

  // ---- Cross-workspace isolation ------------------------------------------

  it('cross-workspace isolation: cases are not visible from another workspace', async () => {
    // Create a case in the primary workspace.
    const finding = makeFinding();
    await svc.createCaseFromFinding(workspaceId, agentId, finding, 'accept');

    // A random (non-existent) workspaceId must return an empty list.
    const otherWsId = randomUUID();
    const otherCases = await svc.listCases(otherWsId, agentId);
    expect(otherCases).toHaveLength(0);
  });

  it('cross-workspace isolation: deleteCase from wrong workspace returns false', async () => {
    const finding = makeFinding();
    const row = await svc.createCaseFromFinding(workspaceId, agentId, finding, 'accept');

    // Attempt to delete from a different workspace — must be a no-op.
    const deleted = await svc.deleteCase(randomUUID(), row.id);
    expect(deleted).toBe(false);

    // Row is still accessible from the correct workspace.
    const listed = await svc.listCases(workspaceId, agentId);
    expect(listed.some((r) => r.id === row.id)).toBe(true);
  });

  // ---- Case name defaults to finding title --------------------------------

  it('createCaseFromFinding: name defaults to the finding title when omitted', async () => {
    const finding = makeFinding({ title: 'Missing null check' });
    const row = await svc.createCaseFromFinding(workspaceId, agentId, finding, 'accept');
    expect(row.name).toBe('Missing null check');
  });

  it('createCaseFromFinding: explicit name overrides the finding title', async () => {
    const finding = makeFinding({ title: 'Should be overridden' });
    const row = await svc.createCaseFromFinding(
      workspaceId,
      agentId,
      finding,
      'accept',
      '',
      'Custom case name',
    );
    expect(row.name).toBe('Custom case name');
  });

  // ---- A gap fix: one-click case stores non-empty inputDiff from PR files ----

  it('A-gap: one-click case with pullRequestId and no inputDiff stores the PR diff (AC-1/AC-6)', async () => {
    // Set up a minimal repo + PR with a pr_files patch so the server can load it.
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'eval-test',
        name: 'eval-repo',
        fullName: 'eval-test/eval-repo',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: null,
      })
      .returning();
    const repoId = repo!.id;

    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 9001,
        title: 'Eval diff test PR',
        author: 'bot',
        branch: 'feat/eval-diff',
        base: 'main',
        headSha: 'deadbeef',
        additions: 5,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    const prId = pr!.id;

    // Insert a pr_files row with a patch — this is what the server will load.
    await pg.handle.db.insert(t.prFiles).values({
      prId,
      path: 'src/auth.ts',
      additions: 5,
      deletions: 0,
      patch: '@@ -18,0 +19,5 @@\n+function checkToken(token: string) {\n+  if (!token) throw new Error("missing token");\n+}',
    });

    const finding = makeFinding({ file: 'src/auth.ts', start_line: 20, end_line: 22 });

    // One-click with pullRequestId but no inputDiff.
    const row = await svc.createCaseFromFinding(
      workspaceId,
      agentId,
      finding,
      'accept',
      undefined, // no inputDiff — server should load from PR
      undefined,
      prId,       // pull_request_id threaded from the client
    );

    expect(row.id).toBeTruthy();
    // The stored inputDiff must be non-empty (AC-6 + A gap fix).
    expect(typeof row.inputDiff).toBe('string');
    expect(row.inputDiff!.length).toBeGreaterThan(0);
    // The diff should cover the finding's file.
    expect(row.inputDiff).toContain('src/auth.ts');
  });

  it('A-gap: one-click case with explicit inputDiff uses it (takes precedence over pullRequestId)', async () => {
    const finding = makeFinding({ file: 'src/config.ts', start_line: 1, end_line: 2 });
    const explicitDiff = '--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,2 +1,2 @@\n+const x = 1;';

    const row = await svc.createCaseFromFinding(
      workspaceId,
      agentId,
      finding,
      'accept',
      explicitDiff,  // explicit takes precedence
      undefined,
      randomUUID(), // would load from a different PR if inputDiff were absent
    );

    // The stored diff must be the explicitly passed one.
    expect(row.inputDiff).toBe(explicitDiff);
  });
});
