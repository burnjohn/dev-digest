/**
 * Hot-path indexes exist after migrations (Testcontainers pg).
 *
 * agent_runs is filtered by (workspace_id, pr_id, status) on every PR page
 * poll, and reviews by pr_id / run_id on every detail read — none of which had
 * an index. The fixture runs the real migration chain, so these assertions
 * prove both the drizzle schema definition AND the generated migration.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('schema indexes (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function indexNames(table: string): Promise<string[]> {
    const rows = await pg.handle.sql`
      select indexname from pg_indexes where schemaname = 'public' and tablename = ${table}`;
    return rows.map((r) => r.indexname as string);
  }

  it('agent_runs has the (workspace_id, pr_id, status) index', async () => {
    expect(await indexNames('agent_runs')).toContain('agent_runs_ws_pr_status_idx');
  });

  it('reviews has pr_id and run_id indexes', async () => {
    const names = await indexNames('reviews');
    expect(names).toContain('reviews_pr_id_idx');
    expect(names).toContain('reviews_run_id_idx');
  });
});
