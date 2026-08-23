/**
 * Smart Diff: `GET /pulls/:id/smart-diff` — `ReviewService.smartDiffForPull`
 * (plan 04-smart-diff.md, T6). Computed on read and persisted nowhere (§5.7):
 * every case that touches "staleness" re-issues the SAME request against the
 * SAME running app rather than restarting it or busting a cache, because
 * there is no cache to bust — that absence IS the thing under test (REQ-25).
 *
 * REQ-8 (the zero-token proof, dynamic half): a spy on `app.container.llm`
 * must never fire. The static half (classify.ts/constants.ts import nothing
 * from adapters/ or any provider SDK) lives in `smart-diff-classify.test.ts`
 * (T2) — not duplicated here.
 *
 * Gated on Docker (needs Postgres) — self-skips via `dockerAvailable()`,
 * matching `intent-api.it.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { hermeticOverrides } from './helpers/overrides.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

interface PrFileFixture {
  path: string;
  additions: number;
  deletions: number;
  patch?: string | null;
}

interface FindingFixture {
  file: string;
  startLine: number;
  endLine: number;
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  title: string;
  dismissedAt?: Date | null;
}

let repoSeq = 0;

async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  files: PrFileFixture[],
) {
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
      number: repoSeq,
      title: `PR #${repoSeq}`,
      author: 'octocat',
      branch: `feat/${repoSeq}`,
      base: 'main',
      headSha: `sha${repoSeq}`,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      filesCount: files.length,
      status: 'needs_review',
      body: null,
    })
    .returning();
  if (files.length > 0) {
    await db.insert(t.prFiles).values(
      files.map((f) => ({
        prId: pr!.id,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      })),
    );
  }
  return { repo: repo!, pr: pr! };
}

/**
 * Insert one `reviews` row + its `findings` rows directly (no model call, no
 * agent run) — the 2026-08-10 insight: model "findings across N runs" as N
 * separate `reviews` rows with `runId` omitted (it is nullable), never
 * distinct run-id strings.
 */
async function insertReviewWithFindings(
  db: PgFixture['handle']['db'],
  args: { workspaceId: string; prId: string; createdAt: Date; findings: FindingFixture[] },
) {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId: args.workspaceId,
      prId: args.prId,
      agentId: null,
      runId: null,
      kind: 'review',
      verdict: null,
      summary: null,
      score: null,
      model: null,
      createdAt: args.createdAt,
    })
    .returning();
  const findingRows =
    args.findings.length > 0
      ? await db
          .insert(t.findings)
          .values(
            args.findings.map((f) => ({
              reviewId: review!.id,
              file: f.file,
              startLine: f.startLine,
              endLine: f.endLine,
              severity: f.severity,
              category: 'bug',
              title: f.title,
              rationale: 'test fixture',
              suggestion: null,
              confidence: 0.9,
              kind: 'finding',
              trifectaComponents: null,
              dismissedAt: f.dismissedAt ?? null,
            })),
          )
          .returning()
      : [];
  return { review: review!, findings: findingRows };
}

d('Smart Diff: GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
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

  function appWith() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: hermeticOverrides(),
    });
  }

  it('REQ-1: five files spanning all three roles return exactly 3 groups, in order, every file in one group', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: 'src/limiter.ts', additions: 10, deletions: 0 }, // unmatched -> core
      { path: 'src/utils/helpers.ts', additions: 5, deletions: 1 }, // unmatched -> core
      { path: 'src/api/routes.ts', additions: 3, deletions: 0 }, // routes.ts -> wiring
      { path: 'package.json', additions: 1, deletions: 0 }, // manifest -> boilerplate (REQ-32)
      { path: 'pnpm-lock.yaml', additions: 200, deletions: 100 }, // lock file -> boilerplate
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.groups).toHaveLength(3);
    expect(body.groups.map((g: { role: string }) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(body.total_files).toBe(5);

    const allPaths = body.groups.flatMap((g: { files: { path: string }[] }) =>
      g.files.map((f) => f.path),
    );
    expect(allPaths.sort()).toEqual(
      ['src/limiter.ts', 'src/utils/helpers.ts', 'src/api/routes.ts', 'package.json', 'pnpm-lock.yaml'].sort(),
    );

    const byRole = Object.fromEntries(
      body.groups.map((g: { role: string; files: { path: string }[] }) => [
        g.role,
        g.files.map((f) => f.path).sort(),
      ]),
    );
    expect(byRole.core).toEqual(['src/limiter.ts', 'src/utils/helpers.ts'].sort());
    expect(byRole.wiring).toEqual(['src/api/routes.ts']);
    expect(byRole.boilerplate).toEqual(['package.json', 'pnpm-lock.yaml'].sort());

    await app.close();
  });

  it('REQ-12: zero reviews still returns correct grouping, empty findings, default_open false everywhere', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: 'src/core.ts', additions: 4, deletions: 0 },
      { path: 'yarn.lock', additions: 50, deletions: 0 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.groups).toHaveLength(3);
    for (const group of body.groups) {
      for (const file of group.files) {
        expect(file.findings).toEqual([]);
        expect(file.default_open).toBe(false);
      }
    }
    expect(body.unmatched_finding_count).toBe(0);

    await app.close();
  });

  it('REQ-7/REQ-23/REQ-25: two reviews with an identical finding dedupe to one entry carrying the NEWER id; ' +
    're-requesting after a newer review, deleting it, and deleting both all update the live response with no restart', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: 'src/limiter.ts', additions: 10, deletions: 0 },
    ]);

    const shared: FindingFixture = {
      file: 'src/limiter.ts',
      startLine: 10,
      endLine: 10,
      severity: 'CRITICAL',
      title: 'Missing bound check',
    };

    const older = await insertReviewWithFindings(pg.handle.db, {
      workspaceId,
      prId: pr.id,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      findings: [shared],
    });

    const firstRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const firstFile = firstRes.json().groups[0].files[0];
    expect(firstFile.findings).toHaveLength(1);
    expect(firstFile.findings[0].id).toBe(older.findings[0]!.id);

    // A second review, strictly newer, reporting the SAME finding — the
    // deduped winner must flip to its id, with no restart / cache bust.
    const newer = await insertReviewWithFindings(pg.handle.db, {
      workspaceId,
      prId: pr.id,
      createdAt: new Date('2026-08-02T00:00:00Z'),
      findings: [shared],
    });

    const secondRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const secondFile = secondRes.json().groups[0].files[0];
    expect(secondFile.findings).toHaveLength(1); // dedup, not append
    expect(secondFile.findings[0].id).toBe(newer.findings[0]!.id);

    // Delete the newer review — the older id resurfaces (REQ-25).
    await pg.handle.db.delete(t.reviews).where(eq(t.reviews.id, newer.review.id));
    const thirdRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const thirdFile = thirdRes.json().groups[0].files[0];
    expect(thirdFile.findings).toHaveLength(1);
    expect(thirdFile.findings[0].id).toBe(older.findings[0]!.id);

    // Delete both reviews — the finding disappears from the payload entirely.
    await pg.handle.db.delete(t.reviews).where(eq(t.reviews.id, older.review.id));
    const fourthRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const fourthFile = fourthRes.json().groups[0].files[0];
    expect(fourthFile.findings).toEqual([]);

    await app.close();
  });

  it('REQ-7: a dismissed finding is absent from the response', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: 'src/limiter.ts', additions: 10, deletions: 0 },
    ]);

    await insertReviewWithFindings(pg.handle.db, {
      workspaceId,
      prId: pr.id,
      createdAt: new Date(),
      findings: [
        {
          file: 'src/limiter.ts',
          startLine: 4,
          endLine: 4,
          severity: 'WARNING',
          title: 'Dismissed finding',
          dismissedAt: new Date(),
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const file = res.json().groups[0].files[0];
    expect(file.findings).toEqual([]);

    await app.close();
  });

  it('REQ-11: a finding on a path absent from pr_files appears in no group and increments unmatched_finding_count', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: 'src/limiter.ts', additions: 10, deletions: 0 },
    ]);

    await insertReviewWithFindings(pg.handle.db, {
      workspaceId,
      prId: pr.id,
      createdAt: new Date(),
      findings: [
        {
          file: 'src/deleted-file.ts',
          startLine: 1,
          endLine: 1,
          severity: 'SUGGESTION',
          title: 'Finding on a file no longer in pr_files',
        },
      ],
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    const body = res.json();
    expect(body.unmatched_finding_count).toBe(1);
    const allFindings = body.groups.flatMap((g: { files: { findings: unknown[] }[] }) =>
      g.files.flatMap((f) => f.findings),
    );
    expect(allFindings).toHaveLength(0);

    await app.close();
  });

  it('REQ-8: the zero-token proof — app.container.llm is never called, and the response is 200', async () => {
    const app = await appWith();
    const llmSpy = vi.spyOn(app.container, 'llm');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: 'src/limiter.ts', additions: 10, deletions: 0 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });

    expect(res.statusCode).toBe(200);
    expect(llmSpy).not.toHaveBeenCalled();

    await app.close();
  });

  it('REQ-20: makes no GitHub call — cached pr_files are served regardless of upstream availability', async () => {
    const app = await appWith();
    const githubSpy = vi.spyOn(app.container, 'github');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, [
      { path: 'src/limiter.ts', additions: 10, deletions: 0 },
    ]);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });

    expect(res.statusCode).toBe(200);
    expect(githubSpy).not.toHaveBeenCalled();

    await app.close();
  });

  it('404s for an unknown prId', async () => {
    const app = await appWith();
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/00000000-0000-0000-0000-000000000000/smart-diff`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
