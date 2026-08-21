import { and, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { ClassifiedIntent } from '@devdigest/shared';
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

// ---- intent ---------------------------------------------------------------

/**
 * Persistence metadata for a classified intent — which provider/model
 * produced it, and when. `model` is nullable: a row written before this
 * feature existed, or a deterministic REQ-7 fallback classification, may
 * carry no model. `generatedAt` defaults to "now" so a caller re-classifying
 * (`force: true`) doesn't have to remember to bump it on every call site.
 */
export interface IntentMeta {
  model: string | null;
  generatedAt?: Date;
}

/**
 * `getIntent`'s return shape: the existing `ClassifiedIntent` contract type
 * plus the persistence metadata the wire's `PrIntentDetail` needs. Assembling
 * the full `PrIntentDetail` — adding `pr_id`, converting `generatedAt` to an
 * ISO string for the wire — is the SERVICE's job (see T6 in
 * docs/plans/03-intent-layer.md), not the repository's.
 */
export interface StoredIntent extends ClassifiedIntent {
  model: string | null;
  generatedAt: Date;
}

export async function upsertIntent(
  db: Db,
  prId: string,
  intent: ClassifiedIntent,
  meta: IntentMeta,
): Promise<void> {
  const values = {
    prId,
    intent: intent.intent,
    inScope: intent.in_scope,
    outOfScope: intent.out_of_scope,
    confidence: intent.confidence,
    sources: intent.sources,
    model: meta.model,
    generatedAt: meta.generatedAt ?? new Date(),
  };
  await db.insert(t.prIntent).values(values).onConflictDoUpdate({
    target: t.prIntent.prId,
    set: values,
  });
}

export async function getIntent(db: Db, prId: string): Promise<StoredIntent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    sources: row.sources,
    model: row.model,
    generatedAt: row.generatedAt,
  };
}
