import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * F1 — repos data-access layer. Owns every WRITE to the `repos` table and
 * most reads — but not all: `github-tokens/repository.ts`'s `list()` and
 * `repoCountFor()` also SELECT from `repos` (correlated subquery / count, to
 * report `repo_count` per token), and `repoCountFor(id)` there is deliberately
 * unscoped by workspace (see its docblock). Every query here is scoped by
 * `workspaceId` (tenancy guard).
 */

// Re-exported from db/rows.ts (the shared row-type home) so other modules can
// name this shape without importing this module's data layer.
export type { RepoRow } from '../../db/rows.js';
import type { RepoRow } from '../../db/rows.js';

/** A repo plus the LABEL of the token it authenticates with (null when none). */
export type RepoWithTokenRow = RepoRow & { githubTokenLabel: string | null };

export interface InsertRepo {
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  createdBy: string;
  /** Omitted / null ⇒ the repo is created with no token (the broken state). */
  githubTokenId?: string | null;
}

export class RepoRepository {
  constructor(private db: Db) {}

  /**
   * Repos joined to their token's label. A LEFT join, so a repo with no token
   * still comes back — that is the state the UI has to show, not one to filter
   * out. One query for the list + its badge.
   */
  private withTokenWhere(where: SQL | undefined): Promise<RepoWithTokenRow[]> {
    return this.db
      .select({ repo: t.repos, githubTokenLabel: t.githubTokens.label })
      .from(t.repos)
      .leftJoin(t.githubTokens, eq(t.repos.githubTokenId, t.githubTokens.id))
      .where(where)
      .then((rows) =>
        rows.map((r) => ({ ...r.repo, githubTokenLabel: r.githubTokenLabel ?? null })),
      );
  }

  async listWithToken(workspaceId: string): Promise<RepoWithTokenRow[]> {
    return this.withTokenWhere(eq(t.repos.workspaceId, workspaceId));
  }

  /** One repo with its token label — the shape every repo response uses. */
  async getWithToken(workspaceId: string, id: string): Promise<RepoWithTokenRow | undefined> {
    const [row] = await this.withTokenWhere(
      and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)),
    );
    return row;
  }

  /** Same, by full name — the dedupe path of `add` answers with this shape too. */
  async getWithTokenByFullName(
    workspaceId: string,
    fullName: string,
  ): Promise<RepoWithTokenRow | undefined> {
    const [row] = await this.withTokenWhere(
      and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)),
    );
    return row;
  }

  /** Reassign (or clear with null) the token a repo authenticates with. */
  async assignToken(
    workspaceId: string,
    repoId: string,
    githubTokenId: string | null,
  ): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .update(t.repos)
      .set({ githubTokenId })
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)))
      .returning();
    return row;
  }

  async getById(workspaceId: string, id: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)));
    return row;
  }

  async insert(values: InsertRepo): Promise<RepoRow> {
    const [row] = await this.db
      .insert(t.repos)
      .values({
        workspaceId: values.workspaceId,
        owner: values.owner,
        name: values.name,
        fullName: values.fullName,
        createdBy: values.createdBy,
        githubTokenId: values.githubTokenId ?? null,
      })
      .returning();
    return row!;
  }

  /**
   * Look up the workspace owning a repo (by repo id, no tenancy scope —
   * the JobRunner's `runCloneJob` is the only caller and it already trusted
   * the payload that came out of an authenticated `add()`). Returns null
   * if the repo was deleted before the followup ran.
   */
  async workspaceIdFor(repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ workspaceId: t.repos.workspaceId })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row?.workspaceId ?? null;
  }

  /** Persist the clone path and bump `last_polled_at` once a clone job completes. */
  async updateClonePath(repoId: string, clonePath: string): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ clonePath, lastPolledAt: new Date() })
      .where(eq(t.repos.id, repoId));
  }

  /** Record that a PR-list sync just ran for this repo (polling module). */
  async touchPolledAt(repoId: string): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ lastPolledAt: new Date() })
      .where(eq(t.repos.id, repoId));
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)))
      .returning({ id: t.repos.id });
    return deleted.length > 0;
  }

  async jobById(
    workspaceId: string,
    jobId: string,
  ): Promise<{ id: string; kind: string; status: string; error: string | null } | null> {
    const [row] = await this.db
      .select({ id: t.jobs.id, kind: t.jobs.kind, status: t.jobs.status, error: t.jobs.error })
      .from(t.jobs)
      .where(and(eq(t.jobs.workspaceId, workspaceId), eq(t.jobs.id, jobId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Id of an outstanding clone job for this repo, if any. Used to make refresh
   * idempotent: the payload carries `repoId`, so a JSONB lookup finds a job
   * that is queued or already running.
   */
  async activeCloneJobFor(workspaceId: string, repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: t.jobs.id })
      .from(t.jobs)
      .where(
        and(
          eq(t.jobs.workspaceId, workspaceId),
          eq(t.jobs.kind, 'clone'),
          inArray(t.jobs.status, ['queued', 'running']),
          sql`${t.jobs.payload}->>'repoId' = ${repoId}`,
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }
}
