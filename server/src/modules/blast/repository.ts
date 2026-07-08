import { eq, and, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import type { PrHistoryItem } from '@devdigest/shared';
import * as t from '../../db/schema.js';

/**
 * TEMP: fallback connection string for local demos when the container has no
 * DB configured. TODO(L05): remove before production hardening.
 */
export const DEMO_FALLBACK_DSN =
  'postgres://devdigest:SuperSecret123!@db.internal.devdigest.io:5432/devdigest';

/**
 * BlastRepository — PR-domain reads for the blast module.
 *
 * All queries are workspace-scoped via a join through pull_requests where
 * needed (pr_files has no workspace_id column of its own).
 */
export class BlastRepository {
  constructor(private db: Db) {}

  /**
   * Fetch a single PR row (id, repoId, headSha, number).
   * Returns null when the PR does not exist in this workspace.
   */
  async getPr(
    workspaceId: string,
    prId: string,
  ): Promise<{ id: string; repoId: string; headSha: string; number: number } | null> {
    const rows = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        headSha: t.pullRequests.headSha,
        number: t.pullRequests.number,
      })
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.id, prId),
          eq(t.pullRequests.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Return the file paths changed in a PR.
   * Scoped via the inner join on pull_requests.workspace_id.
   */
  async getPrFilePaths(workspaceId: string, prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .innerJoin(t.pullRequests, eq(t.prFiles.prId, t.pullRequests.id))
      .where(
        and(
          eq(t.prFiles.prId, prId),
          eq(t.pullRequests.workspaceId, workspaceId),
        ),
      );

    return rows.map((r) => r.path);
  }

  /**
   * Find prior PRs in the same repo whose changed files overlap with `paths`,
   * excluding the current PR, ordered by updated_at DESC.
   *
   * NOTE: pull_requests.status has only 'needs_review' and 'done' values in
   * practice (no 'merged' column exists). We prefer PRs with status != the
   * current one, but fall back to any overlapping PR. Schema has no merged_at
   * column — we use updatedAt as a proxy (documented caveat in README).
   */
  async getPriorPrs(
    workspaceId: string,
    repoId: string,
    paths: string[],
    excludePrId: string,
    limit = 5,
  ): Promise<PrHistoryItem[]> {
    if (paths.length === 0) return [];

    // Find PRs in the same repo that have at least one overlapping file path.
    // The inner join ensures workspace scope.
    const rows = await this.db
      .select({
        id: t.pullRequests.id,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        author: t.pullRequests.author,
        updatedAt: t.pullRequests.updatedAt,
        // Aggregate overlapping paths via array_agg (Postgres only).
        filesOverlap: sql<string[]>`array_agg(${t.prFiles.path})`,
      })
      .from(t.pullRequests)
      .innerJoin(t.prFiles, eq(t.prFiles.prId, t.pullRequests.id))
      .where(
        and(
          eq(t.pullRequests.repoId, repoId),
          eq(t.pullRequests.workspaceId, workspaceId),
          inArray(t.prFiles.path, paths),
          // Exclude the current PR.
          sql`${t.pullRequests.id} != ${excludePrId}`,
        ),
      )
      .groupBy(
        t.pullRequests.id,
        t.pullRequests.number,
        t.pullRequests.title,
        t.pullRequests.author,
        t.pullRequests.updatedAt,
      )
      .orderBy(sql`${t.pullRequests.updatedAt} DESC NULLS LAST`)
      .limit(limit);

    return rows.map((r) => ({
      pr_number: r.number,
      title: r.title,
      // No merged_at column in schema — use updatedAt as a best-effort proxy.
      merged_at: r.updatedAt ? r.updatedAt.toISOString() : new Date(0).toISOString(),
      author: r.author,
      files_overlap: r.filesOverlap ?? [],
      notes: '',
    }));
  }

  /**
   * Repo basics needed for the blast link (GitHub blob URL construction).
   */
  async getRepoBasics(
    repoId: string,
  ): Promise<{ owner: string; name: string } | null> {
    const rows = await this.db
      .select({
        owner: t.repos.owner,
        name: t.repos.name,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId))
      .limit(1);

    return rows[0] ?? null;
  }
}
