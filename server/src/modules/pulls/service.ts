import type { Container } from '../../platform/container.js';
import type {
  GitHubClient,
  PrCommentInput,
  PrDetail,
  PrMeta,
  PrReviewComment,
} from '@devdigest/shared';
import { AppError, MissingTokenError, NotFoundError } from '../../platform/errors.js';
import type { PinoLike as Logger } from '../../platform/run-logger.js';
import { PullsRepository, type PullRow, type RepoRow } from './repository.js';
import { BACKFILL_LIMIT } from './constants.js';
import {
  countSeveritiesByPr,
  pickCountedReviews,
  pickLatestCostByPr,
  pickLatestReviewByPr,
  toPrDetail,
  toPrMeta,
} from './helpers.js';

/**
 * F1 — pulls service. Owns the PR import/read orchestration:
 *   list   — sync from GitHub (best effort), backfill diff stats, roll up the
 *            review-derived list columns
 *   detail — refresh from GitHub (best effort), else serve persisted rows
 *   comments — proxied live to GitHub, never mirrored locally
 *
 * LOCAL-FIRST is the rule every method here encodes: a missing token or an
 * unreachable GitHub degrades to persisted data, it never fails the read. The
 * one exception is POSTing a comment, which has nothing to degrade to.
 *
 * Review triggering is owned by the reviews module; this one imports and reads.
 */
export class PullsService {
  private repo: PullsRepository;
  private reviews: Container['reviewRepo'];

  constructor(private container: Container) {
    this.repo = new PullsRepository(container.db);
    this.reviews = container.reviewRepo;
  }

  /**
   * Resolve the GitHub client, or null when none is configured. Callers that
   * can degrade take the null branch; the warning is logged once, here.
   */
  private async githubOrNull(
    githubTokenId: string | null,
    logger?: Logger,
  ): Promise<GitHubClient | null> {
    try {
      // Per-repo tokens: resolve the REPO'S OWN token (or none) — there is
      // deliberately no fallback to a global/env token.
      return await this.container.github(githubTokenId);
    } catch (err) {
      logger?.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted data');
      return null;
    }
  }

  // ===========================================================================
  // GET /repos/:id/pulls

  async list(workspaceId: string, repoId: string, logger?: Logger): Promise<PrMeta[]> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await this.githubOrNull(repo.githubTokenId, logger);
    if (gh) await this.syncFromGitHub(gh, workspaceId, repo, logger);

    const rows = await this.repo.listByRepo(repo.id);
    if (gh) await this.backfillDiffStats(gh, repo, rows, logger);

    return this.rollup(rows);
  }

  /** Import every PR GitHub reports for the repo. Best effort — never throws. */
  private async syncFromGitHub(
    gh: GitHubClient,
    workspaceId: string,
    repo: RepoRow,
    logger?: Logger,
  ): Promise<void> {
    try {
      const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
      for (const pr of pulls) {
        await this.repo.upsertFromGitHub(workspaceId, repo.id, pr);
      }
    } catch (err) {
      logger?.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
    }
  }

  /**
   * Fill in the diff stats GitHub's list payload omits, for PRs still sitting
   * at all-zero. Capped at BACKFILL_LIMIT per request. Mutates `rows` in place
   * so the response reflects the backfill without a second read.
   */
  private async backfillDiffStats(
    gh: GitHubClient,
    repo: RepoRow,
    rows: PullRow[],
    logger?: Logger,
  ): Promise<void> {
    const needStats = rows
      .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
      .slice(0, BACKFILL_LIMIT);
    for (const r of needStats) {
      try {
        const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
        await this.repo.updateDiffStats(r.id, {
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        });
        r.additions = detail.additions;
        r.deletions = detail.deletions;
        r.filesCount = detail.files_count;
      } catch (err) {
        logger?.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
      }
    }
  }

  /**
   * The list's review-derived columns (score, severity chips, cost), computed
   * on read from the reviews domain — no FK denormalisation on `pull_requests`.
   * Three batched queries plus pure grouping; the list is small.
   */
  private async rollup(rows: PullRow[]): Promise<PrMeta[]> {
    const prIds = rows.map((r) => r.id);
    const reviewRows = await this.reviews.reviewSummariesForPulls(prIds);

    const latestReviewByPr = pickLatestReviewByPr(reviewRows);
    const countedReviews = pickCountedReviews(reviewRows);

    const findingRows = await this.reviews.findingSeveritiesForReviews([...countedReviews.keys()]);
    const countsByPr = countSeveritiesByPr(findingRows, countedReviews);

    const costByPr = pickLatestCostByPr(await this.reviews.doneRunCostsForPulls(prIds));

    const now = Date.now();
    return rows.map((row) =>
      toPrMeta(row, {
        review: latestReviewByPr.get(row.id),
        costUsd: costByPr.get(row.id),
        counts: countsByPr.get(row.id),
        now,
      }),
    );
  }

  // ===========================================================================
  // GET /pulls/:id

  async detail(workspaceId: string, prId: string, logger?: Logger): Promise<PrDetail> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);

    // Local-first: refresh from GitHub when reachable, else serve what we have.
    try {
      const gh = await this.container.github(repo.githubTokenId);
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);
      await this.repo.replaceDetail(pr.id, detail);
      return { ...detail, id: pr.id };
    } catch (err) {
      logger?.warn(
        { err },
        'GitHub PR detail refresh skipped (no token / offline); serving persisted detail',
      );
      const [files, commits] = await Promise.all([
        this.repo.getFiles(pr.id),
        this.repo.getCommits(pr.id),
      ]);
      return toPrDetail(pr, files, commits);
    }
  }

  /**
   * PR detail addressed by (repo uuid, GitHub number) — the client's PR page
   * loads directly by number, so it must not resolve the uuid through the whole
   * pulls list first. Same response as detail(); 404 when the repo is not in
   * the workspace or the number is unknown.
   */
  async detailByNumber(
    workspaceId: string,
    repoId: string,
    number: number,
    logger?: Logger,
  ): Promise<PrDetail> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const pr = await this.repo.getPullByNumber(repo.id, number);
    if (!pr) throw new NotFoundError('Pull request not found');
    return this.detail(workspaceId, pr.id, logger);
  }

  // ===========================================================================
  // Inline review comments (Files changed tab)
  //
  // Proxied live to GitHub with no local persistence: GET reflects the PR's
  // existing comments, POST creates one immediately. Keeps the tab in lock-step
  // with GitHub instead of maintaining a mirror that can go stale.

  async listComments(
    workspaceId: string,
    prId: string,
    logger?: Logger,
  ): Promise<PrReviewComment[]> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);
    const gh = await this.githubOrNull(repo.githubTokenId, logger);
    if (!gh) return [];
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
    } catch (err) {
      logger?.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  async createComment(
    workspaceId: string,
    prId: string,
    input: PrCommentInput,
  ): Promise<PrReviewComment> {
    const { pr, repo } = await this.resolvePrAndRepo(workspaceId, prId);

    // Posting has nothing to degrade to. A missing/unresolvable token keeps its
    // own error (→ 422 token_missing with the actionable message) rather than
    // being downgraded to a generic 400; only OTHER construction failures
    // (network, misconfiguration) become github_unavailable.
    let gh: GitHubClient;
    try {
      gh = await this.container.github(repo.githubTokenId);
    } catch (err) {
      if (err instanceof MissingTokenError) throw err;
      throw new AppError('github_unavailable', 'Connect a GitHub token to post comments.', 400);
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
  }

  /** Workspace-scoped PR lookup plus its repo — the guard every route shares. */
  private async resolvePrAndRepo(
    workspaceId: string,
    prId: string,
  ): Promise<{ pr: PullRow; repo: RepoRow }> {
    const pr = await this.repo.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepoById(pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }
}
