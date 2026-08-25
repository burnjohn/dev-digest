import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { MAX_REVERSE_WALK_FRONTIER } from './constants.js';
import type {
  BlastPrRow,
  ChangedFileFactsRow,
  OtherPrMetaRow,
  PrFileOverlapRow,
  ReverseEdgeRow,
} from './types.js';

/**
 * `blast` data-access layer. The ONLY file in this module that imports
 * `drizzle-orm` (`onion-architecture` §2/§4 — R3 owns SQL). Every read is
 * scoped by `workspaceId`/`repoId`, and every method is a plain
 * `select().from().where()` — never a query builder, an `SQL` fragment or a
 * `Db` returned to the caller (`onion-architecture` §5 Drizzle, rule 4).
 *
 * `getChangedFiles` reads `pr_files` directly — it does NOT reuse
 * `reviews/repository/pull.repo.ts::filesForPull`, even though the query is
 * nearly identical, because `onion-architecture` rule 2 forbids one module
 * importing another module's repository (docs/plans/06-blast-radius.md §5).
 *
 * `getFileFactsForFiles` is the whole fix for gap G1 (REQ-5): endpoints and
 * crons declared DIRECTLY in a changed file, read straight from `file_facts`,
 * independent of whatever `repoIntel.getBlastRadius` returns for callers. T5
 * reuses it unchanged to attach chips to `file_impact[]`'s reached files too.
 *
 * `hasFileEdges` / `getReverseEdges` / `getOtherPrsOfRepo` / `hasCachedPrFilesFor`
 * / `getPrFileOverlap` are T5's additions (REQ-9/REQ-10). None of them joins,
 * groups or orders in SQL — `pr_files` carries no `repo_id` column (only
 * `pr_id`), so "this repo's other PRs" is its own read, and the
 * group/sort/cap that a join+groupBy would normally do in one statement
 * happens in `helpers.ts` instead, PURE, over the raw rows these methods
 * return (`onion-architecture` §5 Drizzle rule 3 — a repository returns row
 * types or DTOs, so grouping/ordering/capping is `helpers.ts`'s job, never
 * SQL run in R3; the direction is `service.ts` calling the pure helper,
 * never the reverse — R3-returns-rows). Every read that scopes by an id set
 * (repo/PR) also re-asserts that scope in JS on the returned rows — the same
 * "belt and suspenders" style already used in `helpers.ts` for per-symbol
 * caller exclusion.
 */
export class BlastRepository {
  constructor(private db: Db) {}

  /** The PR row, scoped to the requesting workspace. `undefined` => 404 at the route. */
  async getPr(workspaceId: string, prId: string): Promise<BlastPrRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        headSha: t.pullRequests.headSha,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /** The PR's changed-file paths (REQ-4) — cached `pr_files`, no GitHub call, no clone re-read. */
  async getChangedFiles(prId: string): Promise<string[]> {
    const rows = await this.db
      .select({ path: t.prFiles.path })
      .from(t.prFiles)
      .where(eq(t.prFiles.prId, prId));
    return rows.map((r) => r.path);
  }

  /** `file_facts` for the CHANGED files themselves (REQ-5 / gap G1). */
  async getFileFactsForFiles(repoId: string, files: string[]): Promise<ChangedFileFactsRow[]> {
    if (files.length === 0) return [];
    const rows = await this.db
      .select({
        filePath: t.fileFacts.filePath,
        endpoints: t.fileFacts.endpoints,
        crons: t.fileFacts.crons,
      })
      .from(t.fileFacts)
      .where(and(eq(t.fileFacts.repoId, repoId), inArray(t.fileFacts.filePath, files)));
    return rows.map((r) => ({
      filePath: r.filePath,
      endpoints: (r.endpoints as string[]) ?? [],
      crons: (r.crons as string[]) ?? [],
    }));
  }

  /**
   * True iff `file_edges` has ANY row for this repo. Distinguishes "this repo
   * has no import graph indexed at all" from "the walk genuinely found no
   * importers" — REQ-9's `coverage.imports_available` must report the former
   * as `false`, never as an honest-looking empty walk.
   */
  async hasFileEdges(repoId: string): Promise<boolean> {
    const rows = await this.db
      .select({ repoId: t.fileEdges.repoId })
      .from(t.fileEdges)
      .where(eq(t.fileEdges.repoId, repoId));
    return rows.some((r) => r.repoId === repoId);
  }

  /**
   * ONE level of the reverse-import walk (REQ-9): files that import any file
   * in `toFiles` — i.e. `fromFile` where `toFile IN (…)`, using the reverse
   * index `file_edges_repo_to_idx (repoId, toFile)`. Called exactly twice by
   * `service.ts` (never recursively, never a CTE) to realize the two-level
   * bound (`REVERSE_WALK_MAX_DEPTH`).
   *
   * `toFiles` is capped at `MAX_REVERSE_WALK_FRONTIER` HERE, inside the
   * method that builds the query — not left to the caller — so this can
   * never regress into an unbounded `inArray` over a wide fan-in.
   */
  async getReverseEdges(repoId: string, toFiles: string[]): Promise<ReverseEdgeRow[]> {
    if (toFiles.length === 0) return [];
    const frontier = toFiles.slice(0, MAX_REVERSE_WALK_FRONTIER);
    const frontierSet = new Set(frontier);
    const rows = await this.db
      .select({ repoId: t.fileEdges.repoId, fromFile: t.fileEdges.fromFile, toFile: t.fileEdges.toFile })
      .from(t.fileEdges)
      .where(and(eq(t.fileEdges.repoId, repoId), inArray(t.fileEdges.toFile, frontier)));
    return rows
      .filter((r) => r.repoId === repoId && frontierSet.has(r.toFile))
      .map((r) => ({ fromFile: r.fromFile, toFile: r.toFile }));
  }

  /**
   * Metadata for every OTHER pull request of this repo (REQ-10) — never a
   * SQL join with `pr_files`, since `pr_files` has no `repo_id` column of its
   * own. `hasCachedPrFilesFor` / `getPrFileOverlap` below take this method's
   * result's ids as their scope.
   */
  async getOtherPrsOfRepo(repoId: string, excludePrId: string): Promise<OtherPrMetaRow[]> {
    const rows = await this.db
      .select({
        id: t.pullRequests.id,
        repoId: t.pullRequests.repoId,
        number: t.pullRequests.number,
        title: t.pullRequests.title,
        status: t.pullRequests.status,
        updatedAt: t.pullRequests.updatedAt,
      })
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), ne(t.pullRequests.id, excludePrId)));
    return rows
      .filter((r) => r.repoId === repoId && r.id !== excludePrId)
      .map((r) => ({
        id: r.id,
        number: r.number,
        title: r.title,
        status: r.status,
        updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
      }));
  }

  /**
   * True iff ANY of `prIds` (the other PRs' ids from `getOtherPrsOfRepo`) has
   * a cached `pr_files` row — regardless of whether it overlaps this PR's
   * changed files. Distinguishes "no other PR's detail has ever been
   * fetched" from "cached, but none of them overlap" — REQ-10's
   * `coverage.prior_prs_available` must report the former as `false`, never
   * as an honest-looking empty list.
   */
  async hasCachedPrFilesFor(prIds: string[]): Promise<boolean> {
    if (prIds.length === 0) return false;
    const idSet = new Set(prIds);
    const rows = await this.db
      .select({ prId: t.prFiles.prId })
      .from(t.prFiles)
      .where(inArray(t.prFiles.prId, prIds));
    return rows.some((r) => idSet.has(r.prId));
  }

  /** `pr_files` rows for `prIds` whose `path` is in `paths` (REQ-10) — the raw overlap `helpers.ts::buildPriorPrs` groups. */
  async getPrFileOverlap(prIds: string[], paths: string[]): Promise<PrFileOverlapRow[]> {
    if (prIds.length === 0 || paths.length === 0) return [];
    const idSet = new Set(prIds);
    const pathSet = new Set(paths);
    const rows = await this.db
      .select({ prId: t.prFiles.prId, path: t.prFiles.path })
      .from(t.prFiles)
      .where(and(inArray(t.prFiles.prId, prIds), inArray(t.prFiles.path, paths)));
    return rows.filter((r) => idSet.has(r.prId) && pathSet.has(r.path));
  }
}
