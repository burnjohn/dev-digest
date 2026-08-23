/* Pure helpers for IntentCard. Nothing here talks to the network or holds
   state, so the component can recompute on every render.

   WHY THIS IS AN APPROXIMATION: `pr_intent` stores no sha (see the table in
   server/src/db/schema/reviews.ts — prId, intent, scopes, confidence, sources,
   model, generatedAt, and nothing else), so the client cannot ask "which commit
   was this intent derived from". It can only ask "did the head commit land
   after the intent was generated", by joining `PrDetail.commits` on
   `PrDetail.head_sha` for a timestamp. A precise signal needs a `head_sha`
   column on `pr_intent`; that was deliberately deferred.

   Every branch FAILS CLOSED — a missing commit, a null `committed_at`, or an
   unparseable date yields `false`, never a stale banner. A false "your intent
   is out of date" costs the user a needless re-classification (which spends a
   model call); a false "it's fine" costs nothing they can't see for themselves
   in the diff. */
import type { PrCommit } from "@devdigest/shared";

/**
 * Was this intent generated BEFORE the PR's current head commit?
 *
 * Deliberately NOT keyed on `PrMeta.updated_at`: GitHub bumps that on every
 * comment, label, and body edit, so it would flag an intent as stale for
 * activity that changed no code at all.
 */
export function isIntentStale(
  generatedAt: string | null | undefined,
  headSha: string | null | undefined,
  commits: PrCommit[] | null | undefined,
): boolean {
  if (!generatedAt || !headSha || !commits?.length) return false;

  // The head commit may be absent: GitHub's PR commits endpoint caps at 250,
  // and the detail route can also degrade to a cached commit list.
  const committedAt = commits.find((c) => c.sha === headSha)?.committed_at;
  if (!committedAt) return false;

  const generated = Date.parse(generatedAt);
  const committed = Date.parse(committedAt);
  if (Number.isNaN(generated) || Number.isNaN(committed)) return false;

  return committed > generated;
}
