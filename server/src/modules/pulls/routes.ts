import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type {
  PrMeta,
  PrDetail,
  GitHubClient,
  PrReviewComment,
  PrListFinding,
} from '@devdigest/shared';
import { PrCommentInput } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { deriveReviewStatus } from './status.js';

/**
 * F1 — pulls module. PR import via Octokit (list + per-PR detail).
 *   GET /repos/:id/pulls → list PRs for a repo (open + recently merged/closed,
 *                          synced from GitHub, persisted). `status` is GitHub's
 *                          merge state (open/merged/closed).
 *   GET /pulls/:id       → full PR detail (diff/files, commits, body, linked issue)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL
 * and owned by A2 — this module only imports/reads.
 */

/** Worst-first ordering for the list's embedded findings. */
const SEV_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };
/** Max findings embedded per PR on the list. Counts stay uncapped. */
const LIST_FINDINGS_CAP = 10;
/** The hover popup clamps rationale to two lines (~110 chars visible). */
const LIST_RATIONALE_MAX = 200;

type FindingsBucket = {
  critical: number;
  warning: number;
  suggestion: number;
  list: PrListFinding[];
};
export default async function pullsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get('/repos/:id/pulls', { schema: { params: IdParams } }, async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');

    let gh: GitHubClient | null = null;
    try {
      gh = await container.github();
    } catch (err) {
      app.log.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    }

    // Local-first: sync from GitHub when a token is configured, but never
    // fail the read — already-imported/seeded PRs stay viewable offline.
    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
        for (const pr of pulls) {
          await container.db
            .insert(t.pullRequests)
            .values({
              workspaceId,
              repoId: repo.id,
              number: pr.number,
              title: pr.title,
              author: pr.author,
              branch: pr.branch,
              base: pr.base,
              headSha: pr.head_sha,
              additions: pr.additions,
              deletions: pr.deletions,
              filesCount: pr.files_count,
              status: pr.status,
              openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
              updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
            })
            .onConflictDoUpdate({
              target: [t.pullRequests.repoId, t.pullRequests.number],
              set: {
                title: pr.title,
                headSha: pr.head_sha,
                status: pr.status,
                updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
              },
            });
        }
      } catch (err) {
        app.log.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id));

    // Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs
    // land with zeroed size/diff. Backfill them once from the detail endpoint
    // so the list shows real S/M/L + ± counts. Capped per request (each backfill
    // is a detail fetch) — the periodic refetch chips away at any remainder.
    const BACKFILL_LIMIT = 10;
    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
          await container.db
            .update(t.pullRequests)
            .set({
              additions: detail.additions,
              deletions: detail.deletions,
              filesCount: detail.files_count,
            })
            .where(eq(t.pullRequests.id, r.id));
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
        } catch (err) {
          app.log.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // Latest-review SCORE + FINDINGS per PR, for the list's score ring and its
    // FINDINGS column. Computed on read from reviews (no FK denorm); the list is
    // small, so one IN-query + JS grouping is cheap. The review id is carried
    // through a reverse map so the findings query below can scope itself to
    // exactly these reviews.
    const prIds = rows.map((r) => r.id);
    const latestReviewByPr = new Map<string, { id: string; score: number | null }>();
    const prByReviewId = new Map<string, string>();
    if (prIds.length > 0) {
      const reviewRows = await container.db
        .select({ id: t.reviews.id, prId: t.reviews.prId, score: t.reviews.score })
        .from(t.reviews)
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .orderBy(desc(t.reviews.createdAt));
      // Rows are newest-first → first seen per PR is the latest review.
      for (const rv of reviewRows) {
        if (latestReviewByPr.has(rv.prId)) continue;
        latestReviewByPr.set(rv.prId, { id: rv.id, score: rv.score });
        prByReviewId.set(rv.id, rv.prId);
      }
    }

    // FINDINGS of that SAME latest review, for the list's FINDINGS column
    // (severity badges + a hover popup that must open with no loading state).
    // One IN-query over the latest review ids — never one query per PR.
    //
    // Live rows, not the `agent_runs.critical_count/...` snapshot: that snapshot
    // is frozen at run completion (see server/INSIGHTS.md) and still counts
    // findings the user has since dismissed, and `agent_runs` has no FK to
    // `reviews` so it cannot be scoped to the latest review at all. The popup
    // shows real finding rows, so the badge must count exactly those rows or the
    // two visibly disagree. Dismissed findings are excluded from BOTH; accepted
    // ones still count. This route's counts will therefore legitimately diverge
    // from the run timeline's after a dismissal — different questions.
    const findingsByPr = new Map<string, FindingsBucket>();
    const latestReviewIds = [...prByReviewId.keys()];
    if (latestReviewIds.length > 0) {
      const findingRows = await container.db
        .select({
          id: t.findings.id,
          reviewId: t.findings.reviewId,
          severity: t.findings.severity,
          category: t.findings.category,
          title: t.findings.title,
          file: t.findings.file,
          startLine: t.findings.startLine,
          endLine: t.findings.endLine,
          rationale: t.findings.rationale,
          confidence: t.findings.confidence,
        })
        .from(t.findings)
        .where(
          and(inArray(t.findings.reviewId, latestReviewIds), isNull(t.findings.dismissedAt)),
        );

      for (const f of findingRows) {
        const prId = prByReviewId.get(f.reviewId);
        // `severity` is a bare text column with no CHECK constraint. An
        // unrecognised value can be neither badged nor counted, so drop it from
        // both — otherwise the client's "+N more" arithmetic goes wrong.
        if (!prId || SEV_RANK[f.severity] === undefined) continue;
        let bucket = findingsByPr.get(prId);
        if (!bucket) {
          bucket = { critical: 0, warning: 0, suggestion: 0, list: [] };
          findingsByPr.set(prId, bucket);
        }
        if (f.severity === 'CRITICAL') bucket.critical++;
        else if (f.severity === 'WARNING') bucket.warning++;
        else bucket.suggestion++;
        bucket.list.push({
          id: f.id,
          severity: f.severity as PrListFinding['severity'],
          category: f.category as PrListFinding['category'],
          title: f.title,
          file: f.file,
          start_line: f.startLine,
          end_line: f.endLine,
          rationale:
            f.rationale.length > LIST_RATIONALE_MAX
              ? `${f.rationale.slice(0, LIST_RATIONALE_MAX)}…`
              : f.rationale,
          confidence: f.confidence,
        });
      }
      // Worst-first, then most-confident — the same predicate the hover card
      // uses, so the list popup and the timeline popup order identically. Cap
      // AFTER counting so the badges stay the full truth and the client can
      // derive "+N more" from counts − list.length.
      for (const bucket of findingsByPr.values()) {
        bucket.list.sort(
          (a, b) =>
            (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) || b.confidence - a.confidence,
        );
        if (bucket.list.length > LIST_FINDINGS_CAP) bucket.list.length = LIST_FINDINGS_CAP;
      }
    }

    // Latest-run COST per PR for the list's cost column. Same shape as the score
    // block above: one IN-query, newest-first, first-seen-per-PR wins. This is
    // deliberately the LATEST COMPLETED run's cost, not a sum over all runs —
    // the column answers "what does reviewing this PR cost", not "what have I
    // spent on it". Only status='done' rows count, so a later failed run cannot
    // blank out the last successful one.
    const latestCostByPr = new Map<string, number | null>();
    if (prIds.length > 0) {
      const runRows = await container.db
        .select({ prId: t.agentRuns.prId, costUsd: t.agentRuns.costUsd })
        .from(t.agentRuns)
        .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')))
        .orderBy(desc(t.agentRuns.ranAt));
      for (const run of runRows) {
        if (run.prId && !latestCostByPr.has(run.prId)) latestCostByPr.set(run.prId, run.costUsd);
      }
    }

    const now = Date.now();
    return rows.map((r) => {
      const review = latestReviewByPr.get(r.id);
      const found = findingsByPr.get(r.id);
      return {
        id: r.id,
        number: r.number,
        title: r.title,
        author: r.author,
        branch: r.branch,
        base: r.base,
        head_sha: r.headSha,
        additions: r.additions,
        deletions: r.deletions,
        files_count: r.filesCount,
        status: deriveReviewStatus({
          ghStatus: r.status,
          lastReviewedSha: r.lastReviewedSha,
          headSha: r.headSha,
          updatedAt: r.updatedAt,
          now,
        }),
        opened_at: r.openedAt?.toISOString() ?? null,
        updated_at: r.updatedAt?.toISOString() ?? null,
        score: review ? review.score : null,
        cost_usd: latestCostByPr.get(r.id) ?? null,
        // `review ? … : null` is what separates "never reviewed" (null → the
        // column renders "—") from "reviewed and clean" (0 / []).
        critical_count: review ? (found?.critical ?? 0) : null,
        warning_count: review ? (found?.warning ?? 0) : null,
        suggestion_count: review ? (found?.suggestion ?? 0) : null,
        findings: review ? (found?.list ?? []) : null,
      };
    });
  });

  app.get('/pulls/:id', { schema: { params: IdParams } }, async (req): Promise<PrDetail> => {
    const { workspaceId } = await getContext(container, req);
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(
        and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, req.params.id)),
      );
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    // Local-first: refresh detail from GitHub when a token is configured;
    // otherwise serve the persisted files/commits/body (seeded or previously
    // imported) so PR detail works offline.
    try {
      const gh = await container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);

      await container.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      if (detail.files.length > 0) {
        await container.db.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId: pr.id,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await container.db.delete(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      if (detail.commits.length > 0) {
        await container.db.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId: pr.id,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await container.db
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          // Diff stats aren't on GitHub's PR-list payload — backfill them from
          // the detail fetch so the Pull Requests list shows real size/files.
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, pr.id));

      return { ...detail, id: pr.id };
    } catch (err) {
      app.log.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
      const files = await container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      const commits = await container.db.select().from(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        head_sha: pr.headSha,
        additions: pr.additions,
        deletions: pr.deletions,
        files_count: pr.filesCount,
        status: pr.status as PrDetail['status'],
        opened_at: pr.openedAt?.toISOString() ?? null,
        updated_at: pr.updatedAt?.toISOString() ?? null,
        body: pr.body ?? null,
        files: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committed_at: c.committedAt?.toISOString() ?? null,
        })),
      };
    }
  });

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): GET reflects existing PR
  // comments; POST creates one immediately. Keeps the tab in lock-step with
  // GitHub and avoids a stale local mirror.
  async function resolvePrAndRepo(id: string, workspaceId: string) {
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  app.get(
    '/pulls/:id/comments',
    { schema: { params: IdParams } },
    async (req): Promise<PrReviewComment[]> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      let gh: GitHubClient;
      try {
        gh = await container.github();
      } catch (err) {
        app.log.warn({ err }, 'GitHub client unavailable; serving no PR comments');
        return [];
      }
      try {
        return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
      } catch (err) {
        app.log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
        return [];
      }
    },
  );

  app.post(
    '/pulls/:id/comments',
    { schema: { params: IdParams, body: PrCommentInput } },
    async (req): Promise<PrReviewComment> => {
      const { workspaceId } = await getContext(container, req);
      const { pr, repo } = await resolvePrAndRepo(req.params.id, workspaceId);
      const input = req.body;
      let gh: GitHubClient;
      try {
        gh = await container.github();
      } catch {
        throw new AppError(
          'github_unavailable',
          'Connect a GitHub token to post comments.',
          400,
        );
      }
      try {
        return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
          commitId: pr.headSha,
          path: input.path,
          line: input.line,
          ...(input.side ? { side: input.side } : {}),
          body: input.body,
          ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
        });
      } catch (err) {
        // GitHub rejects comments on lines outside the diff / on closed PRs (422).
        const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
        throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
      }
    },
  );
}
