/**
 * GET /pulls/:id/smart-diff (Testcontainers Postgres).
 *
 * Real DB coverage for what `classifier.test.ts` can't: pulling `pr_files` +
 * the LATEST `kind='review'` review's non-dismissed findings out of Postgres
 * and assembling them into groups/order/findings/split_suggestion — plus
 * workspace scoping (404 for another tenant's PR) and the "never reviewed"
 * shape (groups exist, `findings: []`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import type { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

/** A repo + PR created directly (no GitHub sync), in the given workspace. */
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 501,
      title: 'Add rate limiting middleware',
      author: 'marisa.koch',
      branch: 'feat/rate-limit',
      base: 'main',
      headSha: 'deadbeef',
      additions: 30,
      deletions: 4,
      filesCount: 3,
      status: 'open',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

async function addPrFiles(
  db: PgFixture['handle']['db'],
  prId: string,
  files: { path: string; additions: number; deletions: number }[],
) {
  await db.insert(t.prFiles).values(files.map((f) => ({ prId, ...f, patch: null })));
}

async function addReview(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  opts: { kind?: 'summary' | 'review'; createdAt: Date },
) {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId,
      agentId: null,
      runId: null,
      kind: opts.kind ?? 'review',
      verdict: 'request_changes',
      summary: 's',
      score: 50,
      model: 'gpt-4.1',
      createdAt: opts.createdAt,
    })
    .returning();
  return review!;
}

async function addFinding(
  db: PgFixture['handle']['db'],
  reviewId: string,
  values: { file: string; startLine: number; severity: string; dismissedAt?: Date },
) {
  await db.insert(t.findings).values({
    reviewId,
    file: values.file,
    startLine: values.startLine,
    endLine: values.startLine,
    severity: values.severity,
    category: 'bug',
    title: 't',
    rationale: 'r',
    confidence: 0.8,
    dismissedAt: values.dismissedAt ?? null,
  });
}

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
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

  async function appAndGet(prId: string) {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    await app.close();
    return res;
  }

  it('groups files by role, orders core → wiring → boilerplate, and attaches latest-review findings', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addPrFiles(pg.handle.db, pr.id, [
      { path: 'pnpm-lock.yaml', additions: 5, deletions: 0 },
      { path: 'vitest.config.ts', additions: 2, deletions: 1 },
      { path: 'src/modules/reviews/service.ts', additions: 20, deletions: 3 },
    ]);
    // An OLDER review, to prove the LATEST one wins.
    const older = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T09:00:00Z'),
    });
    await addFinding(pg.handle.db, older.id, {
      file: 'src/modules/reviews/service.ts',
      startLine: 999,
      severity: 'SUGGESTION',
    });
    const latest = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T10:00:00Z'),
    });
    await addFinding(pg.handle.db, latest.id, {
      file: 'src/modules/reviews/service.ts',
      startLine: 42,
      severity: 'CRITICAL',
    });
    // Dismissed — must be excluded from the badge.
    await addFinding(pg.handle.db, latest.id, {
      file: 'src/modules/reviews/service.ts',
      startLine: 7,
      severity: 'WARNING',
      dismissedAt: new Date('2026-06-01T10:30:00Z'),
    });

    const res = await appAndGet(pr.id);
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;

    expect(body.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    const core = body.groups.find((g) => g.role === 'core')!;
    expect(core.files).toHaveLength(1);
    expect(core.files[0]!.path).toBe('src/modules/reviews/service.ts');
    // Only the LATEST review's non-dismissed finding survives.
    expect(core.files[0]!.findings).toEqual([{ line: 42, severity: 'CRITICAL' }]);

    const wiring = body.groups.find((g) => g.role === 'wiring')!;
    expect(wiring.files[0]!.path).toBe('vitest.config.ts');
    expect(wiring.files[0]!.findings).toEqual([]);

    const boilerplate = body.groups.find((g) => g.role === 'boilerplate')!;
    expect(boilerplate.files[0]!.path).toBe('pnpm-lock.yaml');

    expect(body.split_suggestion.total_lines).toBe(5 + 3 + 23);
  });

  it('a PR with no review yet still returns groups, with findings: []', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addPrFiles(pg.handle.db, pr.id, [
      { path: 'src/modules/reviews/service.ts', additions: 4, deletions: 0 },
    ]);

    const res = await appAndGet(pr.id);
    expect(res.statusCode).toBe(200);
    const body = res.json() as SmartDiff;
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]!.role).toBe('core');
    expect(body.groups[0]!.files[0]!.findings).toEqual([]);
  });

  it('404s for a PR that belongs to a different workspace', async () => {
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other' }).returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWs!.id);
    await addPrFiles(pg.handle.db, pr.id, [{ path: 'src/x.ts', additions: 1, deletions: 0 }]);

    const res = await appAndGet(pr.id);
    expect(res.statusCode).toBe(404);
  });
});
