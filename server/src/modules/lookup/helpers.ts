import { PrStatus } from '@devdigest/shared';
import type { PullLookup } from '@devdigest/shared';
import type { LookupJoinRow } from './repository.js';

/**
 * `lookup` pure helpers. Row -> DTO mapping only — no I/O, no container
 * (`onion-architecture` §5 Drizzle, rule 3; mirrors `modules/repos/helpers.ts`).
 */

/**
 * `LookupJoinRow` in the branch where `resolve()`'s LEFT JOIN actually found a
 * pull request: every pull-side column the join could null out (`number`,
 * `headSha`, `title`, `status`) is proven non-null here, alongside `pullId`
 * itself — they all come from the SAME joined row, so they are null together
 * or populated together. That is what `isMatchedLookupRow` checks at runtime;
 * this type is what lets `toPullLookup` read them without a `!` assertion.
 */
export type MatchedLookupRow = LookupJoinRow & {
  pullId: string;
  number: number;
  headSha: string;
  title: string;
  status: string;
};

/** True iff `resolve()` found a matching pull request for the join row. */
export function isMatchedLookupRow(row: LookupJoinRow): row is MatchedLookupRow {
  return row.pullId !== null;
}

/**
 * Map a matched join row to the `PullLookup` DTO. `status` is a free-text
 * column with no DB `CHECK` (server/INSIGHTS.md, 2026-08-16), so it is parsed
 * against the contract enum rather than cast — an invalid value throws here
 * instead of silently reaching the wire as an unrecognised status.
 */
export function toPullLookup(row: MatchedLookupRow): PullLookup {
  return {
    repo_id: row.repoId,
    pull_id: row.pullId,
    number: row.number,
    full_name: row.fullName,
    head_sha: row.headSha,
    title: row.title,
    status: PrStatus.parse(row.status),
  };
}
