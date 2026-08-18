import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/** Persisted commit history for a PR — one of the Intent Layer's fallback
 *  signals when the title/body are too thin to classify from. */
export async function getPrCommits(
  db: Db,
  prId: string,
): Promise<(typeof t.prCommits.$inferSelect)[]> {
  return db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent -----------------------------------------------------------------

/** Overwrite the PR's cached Intent (one row per PR). Used both by the
 *  classifier (first classification / manual refresh) and by the review
 *  pipeline when it patches in the post-review `risk_areas` signal. */
export async function upsertIntent(db: Db, prId: string, intent: Intent): Promise<void> {
  const values = {
    prId,
    intent: intent.intent,
    inScope: intent.in_scope,
    outOfScope: intent.out_of_scope,
    confidence: intent.confidence,
    signalsUsed: intent.signals_used,
    riskAreas: intent.risk_areas,
    headSha: intent.head_sha ?? null,
  };
  await db
    .insert(t.prIntent)
    .values(values)
    .onConflictDoUpdate({ target: t.prIntent.prId, set: values });
}

export async function getIntent(db: Db, prId: string): Promise<Intent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence as Intent['confidence'],
    signals_used: row.signalsUsed,
    risk_areas: row.riskAreas,
    head_sha: row.headSha,
  };
}
