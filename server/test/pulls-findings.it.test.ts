/**
 * FINDINGS column on GET /repos/:id/pulls.
 *
 * The counts roll up the LATEST review of EACH agent, with dismissed findings
 * excluded. That is a two-hop join (findings → reviews) plus an ordering rule,
 * all of it real SQL, so it gets a real Postgres rather than a mock DB.
 *
 * The edges worth pinning: re-running the same agent must REPLACE its earlier
 * numbers (not add to them) while a second agent must ADD to them; a dismissed
 * finding must drop out; and "reviewed and clean" must report zeros while
 * "never reviewed" reports null — the UI renders those two very differently.
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
  const name = `findings-${repoSeq++}`;
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

/** One review with its findings. `severities` may mark a finding dismissed. */
async function addReview(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  prId: string,
  opts: {
    agentId: string | null;
    createdAt: Date;
    kind?: 'review' | 'summary';
    findings: { severity: string; dismissed?: boolean; confidence?: number }[];
  },
) {
  const [review] = await db
    .insert(t.reviews)
    .values({
      workspaceId,
      prId,
      agentId: opts.agentId,
      kind: opts.kind ?? 'review',
      verdict: 'comment',
      score: 60,
      model: 'deepseek/deepseek-v4-flash',
      createdAt: opts.createdAt,
    })
    .returning();
  if (opts.findings.length > 0) {
    await db.insert(t.findings).values(
      opts.findings.map((f, i) => ({
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: f.severity,
        category: 'bug',
        title: `Finding ${i}`,
        rationale: 'because',
        confidence: f.confidence ?? 0.9,
        dismissedAt: f.dismissed ? new Date('2026-06-02T00:00:00Z') : null,
      })),
    );
  }
  return review!;
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

// Stable fake agent ids — `reviews.agent_id` has no FK, so no agent row needed.
const SECURITY = '11111111-1111-4111-8111-111111111111';
const PERF = '22222222-2222-4222-8222-222222222222';

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

  it('breaks one review down per severity', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: SECURITY,
      createdAt: new Date('2026-06-01T10:00:00Z'),
      findings: [
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
      ],
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it('a re-run of the same agent REPLACES its earlier findings', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: SECURITY,
      createdAt: new Date('2026-06-01T09:00:00Z'),
      findings: [{ severity: 'CRITICAL' }, { severity: 'CRITICAL' }, { severity: 'WARNING' }],
    });
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: SECURITY,
      createdAt: new Date('2026-06-01T10:00:00Z'),
      findings: [{ severity: 'CRITICAL' }],
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    // 3 CRITICAL would mean the older run was summed in too.
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
  });

  it('a second agent ADDS to the totals — a multi-agent PR sums every reviewer', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: SECURITY,
      createdAt: new Date('2026-06-01T09:00:00Z'),
      findings: [{ severity: 'CRITICAL' }, { severity: 'CRITICAL' }, { severity: 'WARNING' }],
    });
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: PERF,
      createdAt: new Date('2026-06-01T10:00:00Z'),
      findings: [{ severity: 'WARNING' }, { severity: 'SUGGESTION' }],
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 2, WARNING: 2, SUGGESTION: 1 });
  });

  it('excludes dismissed findings — a resolved finding stops driving the counter', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: SECURITY,
      createdAt: new Date('2026-06-01T10:00:00Z'),
      findings: [
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL', dismissed: true },
        { severity: 'WARNING', dismissed: true },
      ],
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
  });

  it('counts low-confidence findings — that filter is a view toggle, not a tally rule', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: SECURITY,
      createdAt: new Date('2026-06-01T10:00:00Z'),
      findings: [{ severity: 'SUGGESTION', confidence: 0.12 }],
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 1 });
  });

  it('reports zeros — not null — for a PR reviewed clean', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: SECURITY,
      createdAt: new Date('2026-06-01T10:00:00Z'),
      findings: [],
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    // Null here would render a dash, as if the PR had never been reviewed.
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });

  it('reports null for a PR that has never been reviewed', async () => {
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.findings_by_severity).toBeNull();
  });

  it('ignores summary reviews, which carry no findings of their own', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: SECURITY,
      createdAt: new Date('2026-06-01T10:00:00Z'),
      findings: [{ severity: 'WARNING' }],
    });
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: PERF,
      kind: 'summary',
      createdAt: new Date('2026-06-01T11:00:00Z'),
      findings: [{ severity: 'CRITICAL' }],
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 });
  });

  it('keeps every agent-less review — there is nothing to de-duplicate against', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: null,
      createdAt: new Date('2026-06-01T09:00:00Z'),
      findings: [{ severity: 'WARNING' }],
    });
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: null,
      createdAt: new Date('2026-06-01T10:00:00Z'),
      findings: [{ severity: 'WARNING' }],
    });

    const [row] = await listPulls(pg.handle.db, repo.id);
    expect(row!.findings_by_severity).toEqual({ CRITICAL: 0, WARNING: 2, SUGGESTION: 0 });
  });

  it('keeps each PR\'s counts to itself', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const [other] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo.id,
        number: 479,
        title: 'Migrate sessions table',
        author: 'deepak.r',
        branch: 'chore/sessions',
        base: 'main',
        headSha: 'ffff1111',
        additions: 10,
        deletions: 2,
        filesCount: 1,
        status: 'open',
      })
      .returning();
    await addReview(pg.handle.db, workspaceId, pr.id, {
      agentId: SECURITY,
      createdAt: new Date('2026-06-01T10:00:00Z'),
      findings: [{ severity: 'CRITICAL' }],
    });
    await addReview(pg.handle.db, workspaceId, other!.id, {
      agentId: SECURITY,
      createdAt: new Date('2026-06-01T10:00:00Z'),
      findings: [{ severity: 'SUGGESTION' }, { severity: 'SUGGESTION' }],
    });

    const rows = await listPulls(pg.handle.db, repo.id);
    const byNumber = new Map(rows.map((r) => [r.number, r.findings_by_severity]));
    expect(byNumber.get(482)).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
    expect(byNumber.get(479)).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 2 });
  });
});
