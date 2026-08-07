/**
 * FINDINGS column on GET /repos/:id/pulls.
 *
 * The column reports the LATEST review's live, non-dismissed findings — both as
 * per-severity counts and as an embedded (capped) list the hover popup renders
 * without a second fetch. All of that is ordering + filtering in real SQL over
 * reviews/findings, so it gets a real Postgres rather than a mock DB.
 *
 * The edges worth pinning: an older review must not leak into a newer one's
 * counts, a dismissed finding must vanish from the counts AND the list together
 * (the bug is the two diverging), and never-reviewed must report null while
 * reviewed-and-clean reports 0/[] — the UI renders "—" only for the former.
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

/** A repo with one PR, created directly (no GitHub sync) so reviews can attach. */
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `found-${repoSeq++}`;
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

async function addReview(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  values: { createdAt: Date; kind?: 'review' | 'summary'; score?: number },
) {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId,
      kind: values.kind ?? 'review',
      score: values.score ?? 61,
      verdict: 'request_changes',
      model: 'test',
      createdAt: values.createdAt,
    })
    .returning();
  return review!;
}

let findingSeq = 0;

async function addFinding(
  db: PgFixture['handle']['db'],
  reviewId: string,
  values: {
    severity: string;
    title?: string;
    confidence?: number;
    rationale?: string;
    acceptedAt?: Date;
    dismissedAt?: Date;
  },
) {
  await db.insert(t.findings).values({
    reviewId,
    file: 'src/config.ts',
    startLine: 12,
    endLine: 12,
    category: 'security',
    title: values.title ?? `finding-${findingSeq++}`,
    rationale: values.rationale ?? 'Because.',
    confidence: values.confidence ?? 0.9,
    severity: values.severity,
    ...(values.acceptedAt ? { acceptedAt: values.acceptedAt } : {}),
    ...(values.dismissedAt ? { dismissedAt: values.dismissedAt } : {}),
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

const total = (row: PrMeta) =>
  (row.critical_count ?? 0) + (row.warning_count ?? 0) + (row.suggestion_count ?? 0);

d('PR list findings column (Testcontainers pg)', () => {
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

  it('counts only the latest review, not every review on the PR', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const older = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T09:00:00Z'),
    });
    await addFinding(pg.handle.db, older.id, { severity: 'CRITICAL', title: 'stale-crit' });
    await addFinding(pg.handle.db, older.id, { severity: 'WARNING', title: 'stale-warn' });
    await addFinding(pg.handle.db, older.id, { severity: 'SUGGESTION', title: 'stale-sugg' });

    const newer = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T10:00:00Z'),
    });
    await addFinding(pg.handle.db, newer.id, { severity: 'CRITICAL', title: 'live-crit' });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.critical_count).toBe(1);
    expect(row!.warning_count).toBe(0);
    expect(row!.suggestion_count).toBe(0);
    expect(row!.findings).toHaveLength(1);
    expect(row!.findings!.map((f) => f.title)).toEqual(['live-crit']);
  });

  it("ignores a newer kind:'summary' review so the latest real review still wins", async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const review = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T09:00:00Z'),
    });
    await addFinding(pg.handle.db, review.id, { severity: 'WARNING', title: 'from-review' });

    const summary = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T11:00:00Z'),
      kind: 'summary',
    });
    await addFinding(pg.handle.db, summary.id, { severity: 'CRITICAL', title: 'from-summary' });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.warning_count).toBe(1);
    expect(row!.critical_count).toBe(0);
    expect(row!.findings!.map((f) => f.title)).toEqual(['from-review']);
  });

  it('excludes a dismissed finding from the counts AND the embedded list together', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const review = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T09:00:00Z'),
    });
    await addFinding(pg.handle.db, review.id, { severity: 'CRITICAL', title: 'live-a' });
    await addFinding(pg.handle.db, review.id, { severity: 'WARNING', title: 'live-b' });
    await addFinding(pg.handle.db, review.id, {
      severity: 'CRITICAL',
      title: 'triaged-away',
      dismissedAt: new Date('2026-06-02T09:00:00Z'),
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    // Asserted together on purpose: the bug worth catching is the badge count
    // and the popup's row count diverging.
    expect(total(row!)).toBe(2);
    expect(row!.findings).toHaveLength(2);
    expect(row!.critical_count).toBe(1);
    expect(row!.findings!.map((f) => f.title)).not.toContain('triaged-away');
  });

  it('still counts an accepted finding — only dismissal removes it', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const review = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T09:00:00Z'),
    });
    await addFinding(pg.handle.db, review.id, {
      severity: 'CRITICAL',
      title: 'confirmed-real',
      acceptedAt: new Date('2026-06-02T09:00:00Z'),
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.critical_count).toBe(1);
    expect(row!.findings!.map((f) => f.title)).toEqual(['confirmed-real']);
  });

  it('reports null — never 0 — for a PR that has never been reviewed', async () => {
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.critical_count).toBeNull();
    expect(row!.warning_count).toBeNull();
    expect(row!.suggestion_count).toBeNull();
    expect(row!.findings).toBeNull();
  });

  it('reports 0 and [] — never null — when the review exists but is clean', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const review = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T09:00:00Z'),
      score: 100,
    });
    // Every finding dismissed ⇒ reviewed, but nothing live. Distinct from
    // never-reviewed: the UI shows "—" only for null.
    await addFinding(pg.handle.db, review.id, {
      severity: 'WARNING',
      dismissedAt: new Date('2026-06-02T09:00:00Z'),
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.critical_count).toBe(0);
    expect(row!.warning_count).toBe(0);
    expect(row!.suggestion_count).toBe(0);
    expect(row!.findings).toEqual([]);
  });

  it('caps the embedded list at 10 but keeps the counts uncapped, worst-first', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const review = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T09:00:00Z'),
    });
    // 2 CRITICAL, 4 WARNING, 6 SUGGESTION = 12.
    for (let i = 0; i < 2; i++)
      await addFinding(pg.handle.db, review.id, { severity: 'CRITICAL', confidence: 0.5 + i / 10 });
    for (let i = 0; i < 4; i++)
      await addFinding(pg.handle.db, review.id, { severity: 'WARNING', confidence: 0.5 + i / 10 });
    for (let i = 0; i < 6; i++)
      await addFinding(pg.handle.db, review.id, {
        severity: 'SUGGESTION',
        confidence: 0.5 + i / 10,
      });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.critical_count).toBe(2);
    expect(row!.warning_count).toBe(4);
    expect(row!.suggestion_count).toBe(6);
    // Counts stay the full truth so the client can derive "+2 more".
    expect(total(row!)).toBe(12);
    expect(row!.findings).toHaveLength(10);

    const rank: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };
    const ranks = row!.findings!.map((f) => rank[f.severity]!);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(row!.findings![0]!.severity).toBe('CRITICAL');
    // Ties broken by descending confidence: the two CRITICALs are 0.6 then 0.5.
    expect(row!.findings![0]!.confidence).toBeCloseTo(0.6, 6);
    expect(row!.findings![1]!.confidence).toBeCloseTo(0.5, 6);
  });

  it('truncates a long rationale but leaves a short one byte-identical', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const review = await addReview(pg.handle.db, workspaceId, pr.id, {
      createdAt: new Date('2026-06-01T09:00:00Z'),
    });
    await addFinding(pg.handle.db, review.id, {
      severity: 'CRITICAL',
      title: 'long',
      rationale: 'x'.repeat(500),
    });
    await addFinding(pg.handle.db, review.id, {
      severity: 'SUGGESTION',
      title: 'short',
      rationale: 'Just this.',
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    const long = row!.findings!.find((f) => f.title === 'long')!;
    const short = row!.findings!.find((f) => f.title === 'short')!;
    expect(long.rationale).toHaveLength(201); // 200 + the ellipsis
    expect(long.rationale.endsWith('…')).toBe(true);
    expect(short.rationale).toBe('Just this.'); // no stray ellipsis on short text
  });
});
