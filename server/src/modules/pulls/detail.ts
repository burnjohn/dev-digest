import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { PrDetail } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { persistPrDetail } from './pr-files.js';

type PullRow = typeof t.pullRequests.$inferSelect;
type RepoRow = typeof t.repos.$inferSelect;

/**
 * Build the full PR detail body — the ONE code path behind both
 * `GET /pulls/:id` and `GET /repos/:id/pulls/number/:number`.
 *
 * Local-first: refresh detail from GitHub when a token is configured
 * (persisting files/commits/body atomically via persistPrDetail); otherwise
 * serve the persisted detail (seeded or previously imported) so PR detail
 * works offline. Callers resolve + workspace-check `pr` and `repo` first.
 */
export async function loadPrDetail(
  container: Container,
  log: FastifyBaseLogger,
  pr: PullRow,
  repo: RepoRow,
): Promise<PrDetail> {
  try {
    const gh = await container.github(repo.githubTokenId);
    const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);

    // ONE transaction (persistPrDetail): a concurrent review reading pr_files
    // (modules/reviews/diff-loader.ts) must never observe the empty window
    // between the delete and the re-insert.
    await persistPrDetail(container.db, pr.id, detail);

    return { ...detail, id: pr.id };
  } catch (err) {
    log.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
    const files = await container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
    const commits = await container.db
      .select()
      .from(t.prCommits)
      .where(eq(t.prCommits.prId, pr.id));
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
}
