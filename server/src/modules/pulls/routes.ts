import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import type { PrMeta, PrDetail } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * F1 — pulls module (§12). PR import via Octokit (list + per-PR detail).
 *   GET /repos/:id/pulls → list open PRs for a repo (synced from GitHub, persisted)
 *   GET /pulls/:id       → full PR detail (diff/files, commits, body, linked issue)
 *
 * Import is idempotent (unique repo_id+number). Review trigger is MANUAL (§8.1)
 * and owned by A2 — this module only imports/reads.
 */
export default async function pullsRoutes(app: FastifyInstance) {
  const { container } = app;

  app.get<{ Params: { id: string } }>('/repos/:id/pulls', async (req): Promise<PrMeta[]> => {
    const { workspaceId } = await getContext(container, req);
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, req.params.id)));
    if (!repo) throw new NotFoundError('Repo not found');

    // Local-first (§1): sync from GitHub when a token is configured, but never
    // fail the read — already-imported/seeded PRs stay viewable offline.
    try {
      const gh = await container.github();
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

    const rows = await container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id));
    return rows.map((r) => ({
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
      status: r.status as PrMeta['status'],
      opened_at: r.openedAt?.toISOString() ?? null,
      updated_at: r.updatedAt?.toISOString() ?? null,
    }));
  });

  app.get<{ Params: { id: string } }>('/pulls/:id', async (req): Promise<PrDetail> => {
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

    // Local-first (§1): refresh detail from GitHub when a token is configured;
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
}
