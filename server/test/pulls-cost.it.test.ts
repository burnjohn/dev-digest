/**
 * COST column on GET /repos/:id/pulls.
 *
 * The value is the LATEST COMPLETED run's cost, not a sum over runs — a re-run
 * replaces the figure rather than adding to it. That ordering + status filter is
 * real SQL over agent_runs, so it gets a real Postgres rather than a mock DB.
 *
 * The two edges worth pinning: a newer FAILED run must not blank out the last
 * successful cost, and a PR that has never completed a run must report null (the
 * UI renders "—") rather than 0.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

/** A repo with one PR, created directly (no GitHub sync) so runs can attach to it. */
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `costed-${repoSeq++}`;
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
      title: 'Add rate limiting to public API endpoints',
      author: 'marisa.koch',
      branch: 'feat/rate-limit-public',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 247,
      deletions: 38,
      filesCount: 9,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

async function addRun(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  values: { ranAt: Date; status: string; costUsd: number | null },
) {
  await db.insert(t.agentRuns).values({
    workspaceId,
    prId,
    model: 'deepseek/deepseek-v4-flash',
    provider: 'openrouter',
    tokensIn: 8000,
    tokensOut: 500,
    durationMs: 1200,
    findingsCount: 1,
    grounding: '1/1 passed',
    ...values,
  });
}

/** The list route syncs from GitHub first; an empty mock keeps it a no-op. */
const listPulls = async (db: PgFixture['handle']['db'], repoId: string) => {
  const app = await buildApp({
    config: config(),
    db,
    overrides: { github: new MockGitHubClient({ pulls: [] }) },
  });
  const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
  expect(res.statusCode).toBe(200);
  return res.json() as PrMeta[];
};

d('PR list cost column (Testcontainers pg)', () => {
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

  it('reports the latest completed run cost, not the sum of every run', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addRun(pg.handle.db, workspaceId, pr.id, {
      ranAt: new Date('2026-06-01T09:00:00Z'),
      status: 'done',
      costUsd: 0.0012,
    });
    await addRun(pg.handle.db, workspaceId, pr.id, {
      ranAt: new Date('2026-06-01T10:00:00Z'),
      status: 'done',
      costUsd: 0.0031,
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    // 0.0043 would mean the column summed both runs.
    expect(row!.cost_usd).toBeCloseTo(0.0031, 6);
  });

  it('ignores a newer failed run so the last successful cost survives', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addRun(pg.handle.db, workspaceId, pr.id, {
      ranAt: new Date('2026-06-01T09:00:00Z'),
      status: 'done',
      costUsd: 0.0025,
    });
    await addRun(pg.handle.db, workspaceId, pr.id, {
      ranAt: new Date('2026-06-01T11:00:00Z'),
      status: 'failed',
      costUsd: null,
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.cost_usd).toBeCloseTo(0.0025, 6);
  });

  it('reports null — never 0 — for a PR with no completed run', async () => {
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.cost_usd).toBeNull();
  });
});
