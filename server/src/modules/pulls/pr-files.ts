import { eq } from 'drizzle-orm';
import type { PrDetail } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** The slice of a GitHub PR detail this module persists locally. */
export type PersistablePrDetail = Pick<
  PrDetail,
  'body' | 'additions' | 'deletions' | 'files_count' | 'files' | 'commits'
>;

/**
 * Replace a PR's persisted GitHub detail — files, commits, body, diff stats —
 * in ONE transaction.
 *
 * Without the transaction there is a window between `DELETE FROM pr_files` and
 * the re-insert in which a concurrent review (modules/reviews/diff-loader.ts
 * reads pr_files) observes an EMPTY diff; and a failure after the delete
 * commits that empty state permanently.
 *
 * NOTE on ownership: the pulls module has no application layer / unit-of-work
 * port yet, so this persistence helper (the adapter) owns `db.transaction`
 * directly; a unit-of-work port takes this over when the module migrates to
 * the onion layout.
 */
export async function persistPrDetail(
  db: Db,
  prId: string,
  detail: PersistablePrDetail,
): Promise<void> {
  await db.transaction(async (tx) => {
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
        // Diff stats aren't on GitHub's PR-list payload — backfill them from
        // the detail fetch so the Pull Requests list shows real size/files.
        additions: detail.additions,
        deletions: detail.deletions,
        filesCount: detail.files_count,
      })
      .where(eq(t.pullRequests.id, prId));
  });
}
