/**
 * Integration tests for GET /pulls/:id/smart-diff (Testcontainers Postgres).
 *
 * Smart Diff is a deterministic classifier — zero LLM calls. These tests
 * verify the full route → service → DB chain, workspace scoping, file
 * grouping, and findings overlay.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { FastifyInstance } from 'fastify';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[smart-diff] Docker not available — skipping integration tests.');
}

const config = () =>
  loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Counter to generate unique repo names and avoid unique-constraint conflicts. */
let repoSeq = 0;

/** Seed a minimal workspace → repo → PR with pr_files for testing. */
async function setupPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  opts: {
    files?: { path: string; additions?: number; deletions?: number }[];
  } = {},
) {
  const name = `smart-diff-repo-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();

  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'Test PR',
      author: 'dev',
      branch: 'feat/test',
      base: 'main',
      headSha: 'abc123',
      additions: 10,
      deletions: 2,
      filesCount: (opts.files ?? []).length,
      status: 'open',
    })
    .returning();

  if (opts.files && opts.files.length > 0) {
    await db.insert(t.prFiles).values(
      opts.files.map((f) => ({
        prId: pr!.id,
        path: f.path,
        additions: f.additions ?? 5,
        deletions: f.deletions ?? 0,
      })),
    );
  }

  return { repo: repo!, pr: pr! };
}

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
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
  // Test 1: Returns 404 for a PR that has no files (null result from service)
  // -------------------------------------------------------------------------
  it('returns 404 when the PR has no files', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    // Insert a PR with zero files — getSmartDiff returns null → 404
    const { pr } = await setupPr(pg.handle.db, workspaceId, { files: [] });

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/smart-diff`,
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Test 2: Returns 404 for a completely unknown PR UUID
  // -------------------------------------------------------------------------
  it('returns 404 for an unknown PR id', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/pulls/00000000-0000-0000-0000-000000000000/smart-diff',
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // Test 3: Returns correct group structure when no review exists
  // -------------------------------------------------------------------------
  it('returns groups with findingsCount === 0 when no review exists', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const { pr } = await setupPr(pg.handle.db, workspaceId, {
      files: [
        { path: 'src/services/auth.ts', additions: 20, deletions: 3 },
        { path: 'src/routes/index.ts', additions: 5, deletions: 1 },
      ],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/smart-diff`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      groups: { role: string; files: { path: string; findingsCount: number; findings: unknown[] }[] }[];
    };

    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups.length).toBeGreaterThan(0);

    // All files must have zero findings with no review present
    for (const group of body.groups) {
      for (const file of group.files) {
        expect(file.findingsCount).toBe(0);
        expect(file.findings).toHaveLength(0);
      }
    }

    // At least one group with role 'core' (services) or 'wiring' (routes)
    const roles = body.groups.map((g) => g.role);
    expect(roles).toContain('core');
    expect(roles).toContain('wiring');

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Test 4: Returns findingsCount > 0 after a review with findings on a file
  // -------------------------------------------------------------------------
  it('returns findingsCount >= 1 and findings array for a file that has findings', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });

    const { pr } = await setupPr(pg.handle.db, workspaceId, {
      files: [{ path: 'src/services/auth.ts', additions: 20, deletions: 3 }],
    });

    // Create a review for the PR
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'test review',
        score: 50,
        model: 'test',
      })
      .returning();

    // Add a finding on the file we seeded
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: 'src/services/auth.ts',
        startLine: 10,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded secret in auth service',
        rationale: 'Secret key committed in plaintext',
        suggestion: 'Use environment variables',
        confidence: 0.95,
      })
      .returning();

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/smart-diff`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      groups: { role: string; files: { path: string; findingsCount: number; findings: { id: string; startLine: number; severity: string; title: string }[] }[] }[];
    };

    // Find the core group (auth.ts → /services/ → core)
    const coreGroup = body.groups.find((g) => g.role === 'core');
    expect(coreGroup).toBeDefined();

    const authFile = coreGroup!.files.find((f) => f.path === 'src/services/auth.ts');
    expect(authFile).toBeDefined();
    expect(authFile!.findingsCount).toBeGreaterThanOrEqual(1);
    expect(authFile!.findings).toHaveLength(1);
    expect(authFile!.findings[0]).toMatchObject({
      id: finding!.id,
      startLine: 10,
      severity: 'critical',
      title: 'Hardcoded secret in auth service',
    });

    await app.close();
  });

  // -------------------------------------------------------------------------
  // Test 5: No LLM call is made during smart-diff (deterministic only)
  // -------------------------------------------------------------------------
  it('never calls the LLM provider during smart-diff', async () => {
    const mockLlm = new MockLLMProvider('openai');
    const completeSpy = vi.spyOn(mockLlm, 'completeStructured');
    const completionSpy = vi.spyOn(mockLlm, 'complete');

    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openai: mockLlm },
      },
    });

    const { pr } = await setupPr(pg.handle.db, workspaceId, {
      files: [{ path: 'src/services/payments.ts', additions: 10, deletions: 0 }],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/smart-diff`,
    });

    expect(res.statusCode).toBe(200);

    // Neither structured nor raw completion was invoked
    expect(completeSpy).not.toHaveBeenCalled();
    expect(completionSpy).not.toHaveBeenCalled();

    await app.close();
  });
});
