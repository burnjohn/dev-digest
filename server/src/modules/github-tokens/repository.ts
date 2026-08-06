import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type GitHubTokenRow = typeof t.githubTokens.$inferSelect;
export type GitHubTokenRowWithCount = GitHubTokenRow & { repoCount: number };

/**
 * The ONLY place that touches `github_tokens`. Every query scopes by
 * workspace. Token VALUES never appear here — this table is metadata only,
 * the value lives in SecretsProvider under `GITHUB_TOKEN:<id>`.
 */
export class GitHubTokenRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<GitHubTokenRowWithCount[]> {
    const rows = await this.db
      .select({
        id: t.githubTokens.id,
        workspaceId: t.githubTokens.workspaceId,
        label: t.githubTokens.label,
        githubLogin: t.githubTokens.githubLogin,
        createdAt: t.githubTokens.createdAt,
        lastValidatedAt: t.githubTokens.lastValidatedAt,
        // Deliberately no index on repos.github_token_id for this subquery —
        // a single-user local app holds a handful of repos (YAGNI).
        repoCount: sql<number>`(
          SELECT count(*)::int FROM ${t.repos}
          WHERE ${t.repos.githubTokenId} = ${t.githubTokens.id}
        )`,
      })
      .from(t.githubTokens)
      .where(eq(t.githubTokens.workspaceId, workspaceId))
      .orderBy(t.githubTokens.createdAt);
    return rows as GitHubTokenRowWithCount[];
  }

  async getById(workspaceId: string, id: string): Promise<GitHubTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.githubTokens)
      .where(and(eq(t.githubTokens.workspaceId, workspaceId), eq(t.githubTokens.id, id)));
    return row;
  }

  async findByLabel(workspaceId: string, label: string): Promise<GitHubTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.githubTokens)
      .where(and(eq(t.githubTokens.workspaceId, workspaceId), eq(t.githubTokens.label, label)));
    return row;
  }

  async insert(values: { workspaceId: string; label: string }): Promise<GitHubTokenRow> {
    const [row] = await this.db.insert(t.githubTokens).values(values).returning();
    if (!row) throw new Error('insert into github_tokens returned no row');
    return row;
  }

  async updateMeta(
    workspaceId: string,
    id: string,
    values: { label?: string; githubLogin?: string | null; lastValidatedAt?: Date },
  ): Promise<GitHubTokenRow | undefined> {
    const [row] = await this.db
      .update(t.githubTokens)
      .set(values)
      .where(and(eq(t.githubTokens.workspaceId, workspaceId), eq(t.githubTokens.id, id)))
      .returning();
    return row;
  }

  /** How many repos currently point at this token id. */
  async repoCountFor(id: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(t.repos)
      .where(eq(t.repos.githubTokenId, id));
    return row?.count ?? 0;
  }

  /**
   * Count the repos about to be orphaned, then delete. The FK is
   * `ON DELETE SET NULL` — those repos survive, just with no usable token.
   */
  async remove(workspaceId: string, id: string): Promise<{ deleted: boolean; orphaned: number }> {
    const orphaned = await this.repoCountFor(id);
    const gone = await this.db
      .delete(t.githubTokens)
      .where(and(eq(t.githubTokens.workspaceId, workspaceId), eq(t.githubTokens.id, id)))
      .returning({ id: t.githubTokens.id });
    return { deleted: gone.length > 0, orphaned };
  }
}
