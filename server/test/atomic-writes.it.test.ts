/**
 * Atomicity of multi-statement repository writes (Testcontainers pg).
 *
 * Each aggregate write that spans several statements must run in ONE
 * transaction: a failure in a later statement must roll the earlier ones back.
 * The tests force the later statement to fail with a real Postgres trigger
 * (no mocked drizzle), then assert the earlier writes did not survive.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { deleteAgentRun } from '../src/modules/reviews/repository/run.repo.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { persistPrDetail } from '../src/modules/pulls/pr-files.js';
import { upsertSettings } from '../src/modules/settings/store.js';
import type { Finding } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('atomic writes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const db = pg.handle.db;
    const [ws] = await db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'atomic', fullName: 'acme/atomic' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 11,
        title: 'atomicity fixture',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'sha-0',
        status: 'needs_review',
      })
      .returning();
    prId = pr!.id;
    // One shared plpgsql function every per-test trigger points at.
    await pg.handle.sql`
      create or replace function devdigest_test_fail() returns trigger as $$
      begin raise exception 'forced test failure'; end;
      $$ language plpgsql`;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  async function insertRun(status: string): Promise<string> {
    const [run] = await pg.handle.db
      .insert(t.agentRuns)
      .values({ workspaceId, prId, status, source: 'local' })
      .returning();
    return run!.id;
  }

  async function insertReviewFor(runId: string): Promise<string> {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId, prId, runId, kind: 'review' })
      .returning();
    return review!.id;
  }

  describe('deleteAgentRun', () => {
    it('deletes the run AND its review, returns true', async () => {
      const runId = await insertRun('done');
      await insertReviewFor(runId);
      const deleted = await deleteAgentRun(pg.handle.db, workspaceId, runId);
      expect(deleted).toBe(true);
      const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      expect(runs).toHaveLength(0);
      const reviews = await pg.handle.db
        .select()
        .from(t.reviews)
        .where(eq(t.reviews.runId, runId));
      expect(reviews).toHaveLength(0);
    });

    it('returns false for an unknown run and leaves other rows alone', async () => {
      const deleted = await deleteAgentRun(
        pg.handle.db,
        workspaceId,
        '00000000-0000-0000-0000-000000000000',
      );
      expect(deleted).toBe(false);
    });

    it('rolls the review DELETE back when the run DELETE fails (one transaction)', async () => {
      const runId = await insertRun('done');
      const reviewId = await insertReviewFor(runId);
      await pg.handle.sql`
        create trigger devdigest_fail_run_delete before delete on agent_runs
        for each row execute function devdigest_test_fail()`;
      try {
        await expect(deleteAgentRun(pg.handle.db, workspaceId, runId)).rejects.toThrow(
          /forced test failure/,
        );
        // The review DELETE ran first — without a transaction it commits and
        // the review is gone even though the run row survived.
        const reviews = await pg.handle.db
          .select()
          .from(t.reviews)
          .where(eq(t.reviews.id, reviewId));
        expect(reviews).toHaveLength(1);
      } finally {
        await pg.handle.sql`drop trigger devdigest_fail_run_delete on agent_runs`;
      }
      // Cleanup so later tests see a consistent fixture.
      await deleteAgentRun(pg.handle.db, workspaceId, runId);
    });

    it('is workspace-scoped: another workspace deletes nothing', async () => {
      const runId = await insertRun('done');
      const reviewId = await insertReviewFor(runId);
      const [wsB] = await pg.handle.db.insert(t.workspaces).values({ name: 'ws-b-atomic' }).returning();
      const deleted = await deleteAgentRun(pg.handle.db, wsB!.id, runId);
      expect(deleted).toBe(false);
      const reviews = await pg.handle.db
        .select()
        .from(t.reviews)
        .where(and(eq(t.reviews.id, reviewId), eq(t.reviews.runId, runId)));
      expect(reviews).toHaveLength(1);
      await deleteAgentRun(pg.handle.db, workspaceId, runId);
    });
  });

  describe('persistPrDetail (pulls)', () => {
    const detail = (files: { path: string }[], commits: { sha: string }[]) => ({
      body: 'updated body',
      additions: 5,
      deletions: 2,
      files_count: files.length,
      files: files.map((f) => ({ path: f.path, additions: 5, deletions: 2, patch: '@@ -1 +1 @@' })),
      commits: commits.map((c) => ({
        sha: c.sha,
        message: 'msg',
        author: 'a',
        committed_at: null,
      })),
    });

    it('replaces files + commits and updates the PR row in one call', async () => {
      const db = pg.handle.db;
      await db.insert(t.prFiles).values({ prId, path: 'old.ts', additions: 1, deletions: 1 });
      await db.insert(t.prCommits).values({ prId, sha: 'old-sha', message: 'old', author: 'a' });

      await persistPrDetail(db, prId, detail([{ path: 'new-a.ts' }, { path: 'new-b.ts' }], [{ sha: 'new-sha' }]));

      const files = await db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
      expect(files.map((f) => f.path).sort()).toEqual(['new-a.ts', 'new-b.ts']);
      const commits = await db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
      expect(commits.map((c) => c.sha)).toEqual(['new-sha']);
      const [pr] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.id, prId));
      expect(pr!.body).toBe('updated body');
      expect(pr!.additions).toBe(5);
      expect(pr!.filesCount).toBe(2);
    });

    it('rolls the file replacement back when a later statement fails (no empty-diff window commits)', async () => {
      const db = pg.handle.db;
      await persistPrDetail(db, prId, detail([{ path: 'keep.ts' }], [{ sha: 'keep-sha' }]));
      await pg.handle.sql`
        create trigger devdigest_fail_commit_insert before insert on pr_commits
        for each row execute function devdigest_test_fail()`;
      try {
        await expect(
          persistPrDetail(db, prId, detail([{ path: 'next.ts' }], [{ sha: 'next-sha' }])),
        ).rejects.toThrow(/forced test failure/);
        // Without one transaction, the delete+insert of pr_files has already
        // committed by the time the commits statement fails — a concurrent
        // review reading pr_files would see the half-applied state persist.
        const files = await db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
        expect(files.map((f) => f.path)).toEqual(['keep.ts']);
        const commits = await db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
        expect(commits.map((c) => c.sha)).toEqual(['keep-sha']);
      } finally {
        await pg.handle.sql`drop trigger devdigest_fail_commit_insert on pr_commits`;
      }
    });
  });

  describe('ReviewRepository.finalizeRun', () => {
    const FINDING: Finding = {
      id: 'f-1',
      severity: 'WARNING',
      category: 'bug',
      title: 'atomic finding',
      file: 'a.ts',
      start_line: 1,
      end_line: 1,
      rationale: 'r',
      confidence: 0.5,
      kind: 'finding',
    };

    const runValues = {
      status: 'done' as const,
      durationMs: 10,
      tokensIn: 1,
      tokensOut: 1,
      costUsd: null,
      findingsCount: 1,
      grounding: '1/1 passed',
      score: 90,
      blockers: 0,
      error: null,
    };

    const reviewValues = (runId: string) => ({
      workspaceId,
      prId,
      agentId: null,
      runId,
      kind: 'review' as const,
      verdict: 'approve',
      summary: 's',
      score: 90,
      model: 'm',
    });

    it('persists review + findings + markReviewed + completes a running run', async () => {
      const db = pg.handle.db;
      const repo = new ReviewRepository(db);
      const runId = await insertRun('running');

      const out = await repo.finalizeRun({
        review: reviewValues(runId),
        findings: [FINDING],
        headSha: 'sha-done',
        runId,
        run: runValues,
      });

      expect(out.review.runId).toBe(runId);
      expect(out.findings).toHaveLength(1);
      const [run] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      expect(run!.status).toBe('done');
      expect(run!.score).toBe(90);
      const [pr] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.id, prId));
      expect(pr!.lastReviewedSha).toBe('sha-done');
      await deleteAgentRun(db, workspaceId, runId);
    });

    it('never overwrites a cancelled run (status guard survives the transaction)', async () => {
      const db = pg.handle.db;
      const repo = new ReviewRepository(db);
      const runId = await insertRun('cancelled');

      await repo.finalizeRun({
        review: reviewValues(runId),
        findings: [FINDING],
        headSha: 'sha-cancelled',
        runId,
        run: runValues,
      });

      // Exact current semantics: the review IS persisted and the PR marked
      // reviewed, but the agent_runs row keeps its terminal 'cancelled' status.
      const [run] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      expect(run!.status).toBe('cancelled');
      const reviews = await db.select().from(t.reviews).where(eq(t.reviews.runId, runId));
      expect(reviews).toHaveLength(1);
      const [pr] = await db.select().from(t.pullRequests).where(eq(t.pullRequests.id, prId));
      expect(pr!.lastReviewedSha).toBe('sha-cancelled');
      await deleteAgentRun(db, workspaceId, runId);
    });

    it('rolls the review insert back when a later statement fails', async () => {
      const db = pg.handle.db;
      const repo = new ReviewRepository(db);
      const runId = await insertRun('running');
      await pg.handle.sql`
        create trigger devdigest_fail_mark_reviewed before update of last_reviewed_sha on pull_requests
        for each row execute function devdigest_test_fail()`;
      try {
        await expect(
          repo.finalizeRun({
            review: reviewValues(runId),
            findings: [FINDING],
            headSha: 'sha-boom',
            runId,
            run: runValues,
          }),
        ).rejects.toThrow(/forced test failure/);
        const reviews = await db.select().from(t.reviews).where(eq(t.reviews.runId, runId));
        expect(reviews).toHaveLength(0);
        const [run] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
        expect(run!.status).toBe('running');
      } finally {
        await pg.handle.sql`drop trigger devdigest_fail_mark_reviewed on pull_requests`;
        await deleteAgentRun(db, workspaceId, runId);
      }
    });
  });

  describe('upsertSettings (settings)', () => {
    let userId: string;

    beforeAll(async () => {
      const [user] = await pg.handle.db.select().from(t.users);
      userId = user!.id;
    });

    it('upserts several keys and returns the workspace rows', async () => {
      const db = pg.handle.db;
      await upsertSettings(db, workspaceId, userId, { theme: 'light', density: 'compact' });
      const rows = await upsertSettings(db, workspaceId, userId, { theme: 'dark' });
      const byKey = new Map(rows.map((r) => [r.key, r.value]));
      expect(byKey.get('theme')).toBe('dark');
      expect(byKey.get('density')).toBe('compact');
    });

    it('writes all keys or none (one transaction)', async () => {
      const db = pg.handle.db;
      await pg.handle.sql`
        create trigger devdigest_fail_settings_insert before insert on settings
        for each row when (NEW.key = 'boom_key') execute function devdigest_test_fail()`;
      try {
        await expect(
          upsertSettings(db, workspaceId, userId, { a_first_key: 1, boom_key: 2 }),
        ).rejects.toThrow(/forced test failure/);
        const rows = await db
          .select()
          .from(t.settings)
          .where(and(eq(t.settings.workspaceId, workspaceId), eq(t.settings.key, 'a_first_key')));
        expect(rows).toHaveLength(0);
      } finally {
        await pg.handle.sql`drop trigger devdigest_fail_settings_insert on settings`;
      }
    });
  });
});
