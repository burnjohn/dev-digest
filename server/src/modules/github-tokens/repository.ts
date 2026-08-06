import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type GitHubTokenRow = typeof t.githubTokens.$inferSelect;
export type GitHubTokenRowWithCount = GitHubTokenRow & { repoCount: number };

/**
 * Owns every WRITE to `github_tokens` and most reads — but not all:
 * `repos/repository.ts`'s `withTokenWhere` also SELECTs from `github_tokens`
 * (a `leftJoin` to report each repo's token label). Every query HERE scopes
 * by workspace, including `repoCountFor`. Token VALUES never appear in this
 * table — it is metadata only, the value lives in SecretsProvider under
 * `GITHUB_TOKEN:<id>`.
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
        //
        // The right side is a literal `github_tokens.id`, not an interpolated
        // Column — drizzle renders an interpolated Column as a BARE column
        // name with no table qualifier, and `repos` has its own `id` column,
        // so `${t.githubTokens.id}` here rendered as unqualified "id" and
        // Postgres bound it to the subquery's own `repos.id` (inner scope
        // shadows outer), comparing repos.github_token_id to its own id and
        // always returning 0. Qualifying by the outer table's actual SQL name
        // (`.from(t.githubTokens)` is unaliased, so it IS "github_tokens")
        // fixes the correlation.
        repoCount: sql<number>`(
          SELECT count(*)::int FROM ${t.repos}
          WHERE ${t.repos.githubTokenId} = github_tokens.id
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

  /** How many repos currently point at this token id, scoped to its workspace. */
  async repoCountFor(workspaceId: string, id: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(t.repos)
      .where(and(eq(t.repos.githubTokenId, id), eq(t.repos.workspaceId, workspaceId)));
    return row?.count ?? 0;
  }

  /**
   * Count the repos about to be orphaned, then delete. The FK is
   * `ON DELETE SET NULL` — those repos survive, just with no usable token.
   */
  async remove(workspaceId: string, id: string): Promise<{ deleted: boolean; orphaned: number }> {
    const orphaned = await this.repoCountFor(workspaceId, id);
    const gone = await this.db
      .delete(t.githubTokens)
      .where(and(eq(t.githubTokens.workspaceId, workspaceId), eq(t.githubTokens.id, id)))
      .returning({ id: t.githubTokens.id });
    return { deleted: gone.length > 0, orphaned };
  }
}
