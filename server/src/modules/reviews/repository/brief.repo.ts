import { eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import { RiskBriefResponse } from '@devdigest/shared';
import type { RiskBriefResponse as RiskBriefResponseType } from '@devdigest/shared';

/**
 * `pr_brief` data access — one row per PR, PK = `pr_id` (server/specs/SPEC-02-pr-risk-brief.md,
 * T6). `pr_brief` has only `pr_id` and `json`, so the WHOLE `RiskBriefResponse` — including
 * `model` and `generated_at` — lives inside the jsonb `json` column. There is no commit-sha
 * column here, and none of the cache-decision paths in `brief-service.ts` read one (REQ-4).
 *
 * Validate-before-persist sits at THIS write chokepoint (server/INSIGHTS.md, 2026-08-25 — a
 * runtime guarantee parked in an optional helper silently never runs; `pr_brief.json` is opaque
 * jsonb that only fails on read): `upsertBrief` `.parse()`s before writing, `getBrief`
 * `.safeParse()`s before returning and treats a parse failure as a cache MISS (`undefined`),
 * never as a value handed back to a caller.
 */

export async function getBrief(db: Db, prId: string): Promise<RiskBriefResponseType | undefined> {
  const [row] = await db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
  if (!row) return undefined;
  const parsed = RiskBriefResponse.safeParse(row.json);
  return parsed.success ? parsed.data : undefined;
}

/**
 * `onConflictDoUpdate` on the `pr_id` primary key — the same statement that makes the
 * concurrent-POST edge case land as "last write wins, neither request errors" with no
 * unique-violation catch needed.
 */
export async function upsertBrief(
  db: Db,
  prId: string,
  brief: RiskBriefResponseType,
): Promise<void> {
  const parsed = RiskBriefResponse.parse(brief);
  await db
    .insert(t.prBrief)
    .values({ prId, json: parsed })
    .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: parsed } });
}
