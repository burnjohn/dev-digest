import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { reapStaleRunningRuns } from '../src/modules/reviews/repository/run.repo.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('reapStaleRunningRuns (Testcontainers pg)', () => {
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

  it('marks orphaned running runs as failed and returns the count', async () => {
    const db = pg.handle.db;

    // Insert a PR so we have a valid prId for the run (agent_runs.pr_id FK).
    // Seed inserts repos + PRs, so we can reuse the seeded PR.
    const [pr] = await db.select().from(t.pullRequests);
    expect(pr).toBeDefined();

    // Insert a run in 'running' state directly.
    const [inserted] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: null,
        prId: pr!.id,
        provider: null,
        model: null,
        status: 'running',
        source: 'local',
      })
      .returning({ id: t.agentRuns.id });
    const runId = inserted!.id;

    // Call the function under test.
    const reaped = await reapStaleRunningRuns(db);

    // At least 1 run was reaped (the one we just inserted).
    expect(reaped).toBeGreaterThanOrEqual(1);

    // The inserted run is now 'failed'.
    const [updated] = await db
      .select({ status: t.agentRuns.status })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.id, runId));
    expect(updated!.status).toBe('failed');

    // Clean up the inserted run.
    await db.delete(t.agentRuns).where(eq(t.agentRuns.id, runId));
  });
});
