/**
 * Per-PR FINDINGS breakdown on the list response (GET /repos/:id/pulls).
 * The count is: all runs, non-dismissed, de-duplicated across runs by
 * severity|file|lines|title. This test seeds findings across two review rows
 * (modelling two runs — `runId` is a uuid column so we omit it and use two
 * `reviews` rows instead), with one identical finding in both and one dismissed,
 * then asserts the duplicate counts once and the dismissed one is excluded.
 * Gated on Docker (needs Postgres); no GitHub token → the route serves the
 * persisted rows we inserted (never fails the read).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;
async function setupRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `findings-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

async function insertPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  repoId: string,
  number: number,
) {
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number,
      title: `PR #${number}`,
      author: 'octocat',
      branch: `feat/${number}`,
      base: 'main',
      headSha: `sha${number}`,
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return pr!;
}

async function insertReview(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  kind: 'review' | 'summary' = 'review',
) {
  const [review] = await db
    .insert(t.reviews)
    .values({ workspaceId, prId, kind })
    .returning();
  return review!;
}

type SeedFinding = {
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  file: string;
  startLine: number;
  endLine: number;
  title: string;
  dismissed?: boolean;
};

async function insertFindings(
  db: PgFixture['handle']['db'],
  reviewId: string,
  findings: SeedFinding[],
) {
  await db.insert(t.findings).values(
    findings.map((f) => ({
      reviewId,
      file: f.file,
      startLine: f.startLine,
      endLine: f.endLine,
      severity: f.severity,
      category: 'bug',
      title: f.title,
      rationale: 'because',
      confidence: 0.9,
      dismissedAt: f.dismissed ? new Date() : null,
    })),
  );
}

d('GET /repos/:id/pulls — findings_by_severity (Testcontainers pg)', () => {
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

  it('counts each finding once across runs, excludes dismissed, and zero-fills PRs with none', async () => {
    const db = pg.handle.db;
    const repo = await setupRepo(db, workspaceId);

    // PR #1 — findings spread across two review rows (two "runs"):
    const prWith = await insertPr(db, workspaceId, repo.id, 1);
    const DUP = { severity: 'CRITICAL' as const, file: 'a.ts', startLine: 10, endLine: 10, title: 'Null deref' };
    const review1 = await insertReview(db, workspaceId, prWith.id);
    await insertFindings(db, review1.id, [
      DUP,
      { severity: 'WARNING', file: 'b.ts', startLine: 5, endLine: 5, title: 'Unused var' },
    ]);
    const review2 = await insertReview(db, workspaceId, prWith.id);
    await insertFindings(db, review2.id, [
      DUP, // identical finding re-emitted in a second run → must count ONCE
      { severity: 'SUGGESTION', file: 'c.ts', startLine: 1, endLine: 1, title: 'Rename' },
      { severity: 'CRITICAL', file: 'd.ts', startLine: 2, endLine: 2, title: 'Dismissed', dismissed: true },
    ]);

    // PR #2 — no findings at all → served as all-zero, not null.
    const prNone = await insertPr(db, workspaceId, repo.id, 2);

    const app = await buildApp({ config: config(), db });
    const res = await app.inject({ method: 'GET', url: `/repos/${repo.id}/pulls` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrMeta[];

    const withRow = body.find((p) => p.number === 1)!;
    // CRITICAL: DUP counted once (dismissed one excluded) = 1; WARNING = 1; SUGGESTION = 1.
    expect(withRow.findings_by_severity).toEqual({ critical: 1, warning: 1, suggestion: 1 });

    const noneRow = body.find((p) => p.number === 2)!;
    expect(noneRow.id).toBe(prNone.id);
    expect(noneRow.findings_by_severity).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});
