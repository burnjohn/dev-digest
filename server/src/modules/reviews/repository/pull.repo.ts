import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { PrBrief, type Intent, type LlmBrief, type Risk } from '@devdigest/shared';
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

export async function upsertIntent(db: Db, prId: string, intent: Intent): Promise<void> {
  await db
    .insert(t.prIntent)
    .values({
      prId,
      intent: intent.intent,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
    })
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: { intent: intent.intent, inScope: intent.in_scope, outOfScope: intent.out_of_scope },
    });
}

export async function getIntent(db: Db, prId: string): Promise<Intent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
}

export async function getIntentScoped(
  db: Db,
  prId: string,
  workspaceId: string,
): Promise<Intent | undefined> {
  const [row] = await db
    .select({ intent: t.prIntent.intent, inScope: t.prIntent.inScope, outOfScope: t.prIntent.outOfScope })
    .from(t.prIntent)
    .innerJoin(t.pullRequests, eq(t.prIntent.prId, t.pullRequests.id))
    .where(and(eq(t.prIntent.prId, prId), eq(t.pullRequests.workspaceId, workspaceId)));
  if (!row) return undefined;
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
}

// ---- brief (blast radius + risks + history stored as JSONB) ---------------

/**
 * Upsert the composed live PR Brief (L04). Written by the run-executor after a
 * successful review run — deterministic composition, zero LLM calls.
 *
 * PRESERVES any existing `llm` key (written only by explicit generate/regenerate
 * via `upsertLlmBrief`) rather than blind-overwriting the JSONB column — a
 * review-completion must not erase a previously generated risk brief (AC-10).
 *
 * Runs inside `db.transaction()` with a `SELECT ... FOR UPDATE` row lock on the
 * target `pr_brief` row — this is the first place in this module using
 * `db.transaction()`. Without the lock, a review-completion (this function) and
 * a Regenerate click (`upsertLlmBrief`) racing on the same PR could both read
 * the same pre-image and the later writer would silently clobber the earlier
 * writer's update (lost-update). The true concurrency/serialization behavior
 * is NOT hermetically testable (a mock can't model real row-lock blocking) —
 * that test lives in Step 10's `brief-generator.it.test.ts` against a real
 * Postgres connection. This file's hermetic tests cover only the sequential
 * preserve-on-write correctness.
 */
export async function upsertBrief(db: Db, prId: string, brief: PrBrief): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ json: t.prBrief.json })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .for('update'); // row lock — serializes against a concurrent upsertLlmBrief on the same prId
    // Use safeParse (not parse): a pre-existing row written before the `llm`
    // field existed has no such key at all and must not throw here.
    const existingLlm = existing ? PrBrief.partial().safeParse(existing.json).data?.llm : undefined;
    const merged: PrBrief = { ...brief, llm: brief.llm ?? existingLlm ?? null };
    await tx
      .insert(t.prBrief)
      .values({ prId, json: merged })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: merged } });
  });
}

/**
 * Upsert the LLM-derived part of the PR Brief (`llm` + optionally enriched
 * `risks[]`). The ONLY write path the `POST /pulls/:id/brief`
 * generate/regenerate endpoint uses. Same transactional row-lock pattern as
 * `upsertBrief` — see that function's doc comment for the concurrency
 * rationale and the cross-reference to Step 10's integration-level lock test.
 *
 * `enrichedRisks`, when provided, replaces `PrBrief.risks.risks` in the SAME
 * transaction as the `llm` write — a single atomic transaction covers both
 * field groups, avoiding a second separate read-modify-write that would
 * reopen the race this function's row lock closes.
 */
export async function upsertLlmBrief(
  db: Db,
  prId: string,
  llm: LlmBrief,
  enrichedRisks?: Risk[],
): Promise<PrBrief> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ json: t.prBrief.json })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .for('update'); // row lock — serializes against a concurrent upsertBrief on the same prId
    if (!existing) {
      // No deterministic brief exists yet (e.g. PR never reviewed) — still
      // persist a well-formed PrBrief shell so the LLM part is not lost.
      const shell: PrBrief = {
        intent: { intent: '', in_scope: [], out_of_scope: [] },
        blast: { changed_symbols: [], downstream: [], summary: '' },
        risks: { risks: enrichedRisks ?? [] },
        history: { history: [] },
        llm,
      };
      await tx.insert(t.prBrief).values({ prId, json: shell });
      return shell;
    }
    const current = PrBrief.parse(existing.json);
    const merged: PrBrief = {
      ...current,
      risks: enrichedRisks ? { risks: enrichedRisks } : current.risks,
      llm,
    };
    await tx.update(t.prBrief).set({ json: merged }).where(eq(t.prBrief.prId, prId));
    return merged;
  });
}

/**
 * Latest CRITICAL/WARNING findings for a PR, most recent review first — a
 * deterministic (zero-LLM) fact feeding `BriefGeneratorService`'s bounded
 * input (Step 4). MANDATORY workspace scope: joins through `reviews.workspace_id`
 * per `server/AGENTS.md`'s stated invariant for finding reads (this module's
 * `run-executor.ts`/`repository.ts` findings reads follow the same pattern).
 * Generous 20-row cap — `assembleLlmInput` applies its own tighter 10-entry cap.
 */
export async function getLatestFindings(
  db: Db,
  prId: string,
  workspaceId: string,
): Promise<{ title: string; rationale: string; severity: string }[]> {
  const rows = await db
    .select({ title: t.findings.title, rationale: t.findings.rationale, severity: t.findings.severity })
    .from(t.findings)
    .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
    .where(
      and(
        eq(t.reviews.prId, prId),
        eq(t.reviews.workspaceId, workspaceId),
        inArray(t.findings.severity, ['CRITICAL', 'WARNING']),
      ),
    )
    .orderBy(desc(t.reviews.createdAt))
    .limit(20);
  return rows;
}

/**
 * Clear the LLM-derived part of a PR Brief (reset `llm` back to `null`),
 * returning the PR to the "Generate brief" empty state on the client
 * (gating there is `!brief?.llm`). Deliberately leaves the deterministic
 * `intent`/`blast`/`risks`/`history` fields intact — only the generatable
 * part is reset; a subsequent Generate re-populates `llm` and re-merges
 * enriched risks. Same transactional row-lock pattern as `upsertBrief`/
 * `upsertLlmBrief` (see `upsertBrief`'s doc comment for the concurrency
 * rationale) — serializes against a concurrent Generate/regenerate call
 * racing on the same `prId`.
 */
export async function clearLlmBrief(db: Db, prId: string): Promise<PrBrief | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ json: t.prBrief.json })
      .from(t.prBrief)
      .where(eq(t.prBrief.prId, prId))
      .for('update'); // row lock — serializes against a concurrent upsertBrief/upsertLlmBrief on the same prId
    if (!existing) return null;
    const current = PrBrief.parse(existing.json);
    const cleared: PrBrief = { ...current, llm: null };
    await tx.update(t.prBrief).set({ json: cleared }).where(eq(t.prBrief.prId, prId));
    return cleared;
  });
}

export async function getBrief(db: Db, prId: string, workspaceId: string): Promise<PrBrief | undefined> {
  const [row] = await db
    .select({ json: t.prBrief.json })
    .from(t.prBrief)
    .innerJoin(t.pullRequests, eq(t.prBrief.prId, t.pullRequests.id))
    .where(and(eq(t.prBrief.prId, prId), eq(t.pullRequests.workspaceId, workspaceId)));
  if (!row) return undefined;
  return PrBrief.parse(row.json);
}
