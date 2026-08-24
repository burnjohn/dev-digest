import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * `lookup` data-access layer. The ONLY place that touches `repos` and
 * `pull_requests` for this module — every read is scoped by `workspaceId`.
 *
 * `resolve()` is the single DB read the module exists to make cheap: a LEFT
 * JOIN from `repos` to `pull_requests` on `(repoId, number)`, so one round
 * trip distinguishes all three outcomes — `repo_not_found` (no row at all),
 * `pull_not_found` (a row with `pullId` null), and a hit — with no GitHub
 * call and no write. The two `list*` methods below only run on a miss, to
 * build the `candidates` list the caller renders as a next step.
 */

export interface LookupJoinRow {
  repoId: string;
  fullName: string;
  pullId: string | null;
  number: number | null;
  headSha: string | null;
  title: string | null;
  status: string | null;
}

export class LookupRepository {
  constructor(private db: Db) {}

  /** Resolve `(workspaceId, fullName, number)` in one query. See class doc. */
  async resolve(
    workspaceId: string,
    fullName: string,
    number: number,
  ): Promise<LookupJoinRow | undefined> {
    const [row] = await this.db
      .select({
        repoId: t.repos.id,
        fullName: t.repos.fullName,
        pullId: t.pullRequests.id,
        number: t.pullRequests.number,
        headSha: t.pullRequests.headSha,
        title: t.pullRequests.title,
        status: t.pullRequests.status,
      })
      .from(t.repos)
      .leftJoin(
        t.pullRequests,
        and(eq(t.pullRequests.repoId, t.repos.id), eq(t.pullRequests.number, number)),
      )
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
    return row;
  }

  /** Candidate list for `repo_not_found` — the workspace's imported repos. */
  async listImportedRepoFullNames(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .select({ fullName: t.repos.fullName })
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId));
    return rows.map((r) => r.fullName);
  }

  /** Candidate list for `pull_not_found` — the repo's known PR numbers. */
  async listPullNumbers(repoId: string): Promise<string[]> {
    const rows = await this.db
      .select({ number: t.pullRequests.number })
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repoId));
    return rows.map((r) => String(r.number));
  }
}
