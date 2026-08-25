/**
 * `blast` module-local types (docs/plans/06-blast-radius.md, T2 + T5).
 *
 * These are internal row shapes for this module only — never a Drizzle row
 * and never a `@devdigest/shared` contract type (that mapping happens in
 * `helpers.ts`, per `onion-architecture` §1 "Where Zod contracts sit").
 */

/** The subset of `pull_requests` this module needs, scoped to a workspace. */
export interface BlastPrRow {
  id: string;
  repoId: string;
  headSha: string;
}

/** `file_facts` for one file — endpoints/crons declared directly in it (REQ-5 / gap G1). */
export interface ChangedFileFactsRow {
  filePath: string;
  endpoints: string[];
  crons: string[];
}

/**
 * One `file_edges` row read in the REVERSE direction: `fromFile` imports
 * `toFile` (REQ-9). `repository.ts::getReverseEdges` queries `toFile IN (…)`
 * and returns the matching rows unchanged — the walk/dedup logic is pure and
 * lives in `helpers.ts` so `blast-graph.test.ts` can drive it without a DB.
 */
export interface ReverseEdgeRow {
  fromFile: string;
  toFile: string;
}

/**
 * Metadata for an OTHER pull request of the same repo (REQ-10) — i.e. every
 * PR in `pull_requests` except the one being viewed. `pr_files` carries no
 * `repo_id` column (only `pr_id`), so "this repo's other PRs" has to be
 * resolved as its own read and then used to scope the `pr_files` reads below
 * — `onion-architecture` §5 Drizzle rule 4 keeps every repository method a
 * plain `select().from().where()`, never a query-builder leak, so the
 * join/group-by/order-by/cap that would normally live in one SQL statement
 * happens in `helpers.ts::buildPriorPrs` instead (pure, DB-free — exactly
 * what `blast-graph.test.ts` drives). `updatedAt` is already an ISO string or
 * `null` here — no `Date` past the repository boundary.
 */
export interface OtherPrMetaRow {
  id: string;
  number: number;
  title: string;
  status: string;
  updatedAt: string | null;
}

/** One `pr_files` row for an OTHER pr, already scoped to a changed-file path overlap (REQ-10). */
export interface PrFileOverlapRow {
  prId: string;
  path: string;
}
