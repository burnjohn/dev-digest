import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrDetail, PrMeta } from '@devdigest/shared';

/**
 * F1 — pulls data-access layer. The ONLY place that touches `pull_requests`,
 * `pr_files` and `pr_commits` for this module. Reads of `repos` are scoped by
 * `workspaceId` (tenancy guard); PR rows inherit that scope through the repo.
 *
 * Review-derived columns on the PR list (score, findings, cost) are NOT queried
 * here — `reviews`, `findings` and `agent_runs` belong to the reviews domain and
 * are reached through `container.reviewRepo`.
 */

// Row shapes live in db/rows.ts so other modules (and this module's helpers)
// can name them without importing a data layer; re-exported here for callers
// that already reach for them through the repository.
export type { PullRow, RepoRow, PrFileRow, PrCommitRow } from '../../db/rows.js';
import type { PullRow, RepoRow, PrFileRow, PrCommitRow } from '../../db/rows.js';

export class PullsRepository {
  constructor(private db: Db) {}

  // ---- lookups ------------------------------------------------------------

  /** A repo in this workspace, by id. */
  async getRepo(workspaceId: string, repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * A repo by id with no tenancy scope — only ever called with a `repoId` taken
   * off a PR row that was itself workspace-scoped, so the check already happened.
   */
  async getRepoById(repoId: string): Promise<RepoRow | undefined> {
    const [row] = await this.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    return row;
  }

  /** A PR in this workspace, by id. */
  async getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /** A PR by its GitHub number within a repo (unique via pr_repo_number_uq). */
  async getPullByNumber(repoId: string, number: number): Promise<PullRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, number)));
    return row;
  }

  /** Every persisted PR for a repo. */
  listByRepo(repoId: string): Promise<PullRow[]> {
    return this.db.select().from(t.pullRequests).where(eq(t.pullRequests.repoId, repoId));
  }

  getFiles(prId: string): Promise<PrFileRow[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  getCommits(prId: string): Promise<PrCommitRow[]> {
    return this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
  }

  // ---- writes -------------------------------------------------------------

  /**
   * Import one PR from GitHub. Idempotent on (repo_id, number): a re-import
   * refreshes only the fields that actually move, so locally-derived columns
   * (`last_reviewed_sha`, backfilled diff stats) survive a sync.
   */
  async upsertFromGitHub(workspaceId: string, repoId: string, pr: PrMeta): Promise<void> {
    await this.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
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

  /** Backfill the diff stats GitHub's list payload omits. */
  async updateDiffStats(
    prId: string,
    stats: { additions: number; deletions: number; filesCount: number },
  ): Promise<void> {
    await this.db.update(t.pullRequests).set(stats).where(eq(t.pullRequests.id, prId));
  }

  /**
   * Replace the persisted diff for a PR with a freshly-fetched one: files and
   * commits are deleted and re-inserted wholesale (GitHub is the source of
   * truth for both), and the PR row picks up the body + real diff stats.
   */
  async replaceDetail(prId: string, detail: PrDetail): Promise<void> {
    // ONE transaction: a concurrent review's diff fallback reads pr_files, so a
    // delete/insert window would hand it an EMPTY diff; and a crash mid-way must
    // not leave files replaced but commits/stats stale. (The adapter owns
    // db.transaction until this module grows a unit-of-work port.)
    await this.db.transaction(async (tx) => {
      await tx.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
      if (detail.files.length > 0) {
        await tx.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await tx.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
      if (detail.commits.length > 0) {
        await tx.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await tx
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, prId));
    });
  }
}
