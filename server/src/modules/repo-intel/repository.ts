/**
 * repo-intel repository — thin Drizzle helpers over the existing `symbols` /
 * `references` tables (db/schema/context.ts) plus a tolerant probe of the
 * (not-yet-existing) `repo_index_state` table.
 *
 * T1 keeps this file deliberately small: the facade only needs (a) the basic
 * shape of a repo so it can call CodeIndex on the clone, (b) the cached
 * symbols/references blast already persists, and (c) a "does the index state
 * table exist yet?" probe so getIndexState can synthesise a degraded reply
 * before the T2 migration lands.
 *
 * IMPORTANT: the `repo_index_state` table is introduced by T2. Until then the
 * raw-SQL probes below MUST swallow `undefined_table` (Postgres 42P01) so the
 * facade keeps returning degraded — never throws.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { clampIndexedName } from '../../db/schema/context.js';
import type { DegradedReason, FileRankRow, IndexState, IndexStatus } from './types.js';

/** Chunk size for batched inserts — same value blast already uses. */
const INSERT_CHUNK_SIZE = 500;

/** Row shape the indexer pipeline buffers up before persistence. */
export interface IndexerSymbolRow {
  repoId: string;
  path: string;
  name: string;
  kind: string;
  line: number;
  endLine: number | null;
  exported: boolean;
  signature: string | null;
  contentHash: string;
}

export interface IndexerReferenceRow {
  repoId: string;
  fromPath: string;
  toSymbol: string;
  line: number;
  contentHash: string;
}

/** Bundle of values the pipeline persists into `repo_index_state`. */
export interface IndexStateUpsert {
  repoId: string;
  lastIndexedSha: string;
  indexerVersion: number;
  status: IndexStatus;
  filesIndexed: number;
  filesSkipped: number;
  stats: Record<string, unknown>;
}

/** Minimal repo shape the facade needs to call CodeIndex on a clone. */
export interface RepoBasics {
  id: string;
  owner: string;
  name: string;
  defaultBranch: string;
  clonePath: string | null;
}

/** Cached row from the existing `symbols` table (blast persists these). */
export interface CachedSymbolRow {
  path: string;
  name: string;
  kind: string;
  line: number | null;
}

/** Cached row from the existing `references` table. */
export interface CachedReferenceRow {
  fromPath: string;
  toSymbol: string;
  line: number;
}

// --- T3 row shapes ----------------------------------------------------------

/** Import-graph edge (importer → imported), repo-relative paths. */
export interface IndexerEdgeRow {
  fromFile: string;
  toFile: string;
}

/** One `file_rank` row the rank step buffers before persistence. */
export interface IndexerFileRankRow {
  filePath: string;
  pagerank: number;
  hotness: number;
  rank: number;
  percentile: number;
}

/** Precomputed per-file facts (endpoints/crons) the indexer writes for blast. */
export interface IndexerFileFactsRow {
  filePath: string;
  endpoints: string[];
  crons: string[];
}

/** Candidate row for the repo-map renderer (symbols × file_rank). */
export interface RepoMapCandidateRow {
  path: string;
  name: string;
  exported: boolean;
  signature: string | null;
  rank: number;
}

/** Full symbol row (with the T2 columns) — for getSymbolsInFiles + blast. */
export interface FullSymbolRow {
  path: string;
  name: string;
  kind: string;
  line: number | null;
  endLine: number | null;
  exported: boolean;
  signature: string | null;
}

/** A resolved cross-file caller (reference whose decl_file is a changed file). */
export interface ResolvedCallerRow {
  fromPath: string;
  toSymbol: string;
  line: number;
  rank: number;
}

export class RepoIntelRepository {
  constructor(private db: Db) {}

  /** Does this repo exist inside the workspace? The tenancy gate for the
   *  repo-addressed HTTP routes (index-state, resync) — the facade itself is
   *  deliberately tenant-agnostic, so the boundary check lives with the caller. */
  async repoInWorkspace(workspaceId: string, repoId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(and(eq(t.repos.id, repoId), eq(t.repos.workspaceId, workspaceId)));
    return rows.length > 0;
  }

  async getRepoBasics(repoId: string): Promise<RepoBasics | null> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        defaultBranch: t.repos.defaultBranch,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row ?? null;
  }

  /** All cached symbols for a repo (from blast's persistence). */
  async getCachedSymbols(repoId: string): Promise<CachedSymbolRow[]> {
    return this.db
      .select({
        path: t.symbols.path,
        name: t.symbols.name,
        kind: t.symbols.kind,
        line: t.symbols.line,
      })
      .from(t.symbols)
      .where(eq(t.symbols.repoId, repoId));
  }

  /** Cached symbols restricted to the given file paths. */
  async getCachedSymbolsForFiles(repoId: string, paths: string[]): Promise<CachedSymbolRow[]> {
    if (paths.length === 0) return [];
    return this.db
      .select({
        path: t.symbols.path,
        name: t.symbols.name,
        kind: t.symbols.kind,
        line: t.symbols.line,
      })
      .from(t.symbols)
      .where(and(eq(t.symbols.repoId, repoId), inArray(t.symbols.path, paths)));
  }

  /** Cached references whose `toSymbol` matches any of the given names. */
  async getCachedReferencesTo(
    repoId: string,
    toSymbols: string[],
  ): Promise<CachedReferenceRow[]> {
    if (toSymbols.length === 0) return [];
    return this.db
      .select({
        fromPath: t.references.fromPath,
        toSymbol: t.references.toSymbol,
        line: t.references.line,
      })
      .from(t.references)
      .where(
        and(eq(t.references.repoId, repoId), inArray(t.references.toSymbol, toSymbols)),
      );
  }

  /**
   * Read the `repo_index_state` row, if any. Tolerant of the table not yet
   * existing (some dev DBs may not have migration 0004 applied) — returns
   * `null` instead of throwing so the facade synthesises a degraded reply.
   *
   * `durationMs` and `reason` live inside `stats` (the schema column set is
   * status/files_indexed/files_skipped/stats/last_indexed_sha/indexer_version/
   * updated_at) — we project them out here so the IndexState shape stays
   * stable for callers.
   */
  async tryGetIndexState(repoId: string): Promise<IndexState | null> {
    try {
      const [row] = await this.db
        .select()
        .from(t.repoIndexState)
        .where(eq(t.repoIndexState.repoId, repoId));
      if (!row) return null;
      const stats = (row.stats ?? {}) as Record<string, unknown>;
      const durationMs = typeof stats.durationMs === 'number' ? stats.durationMs : 0;
      const reason = typeof stats.reason === 'string' ? stats.reason : undefined;
      // A persisted row is the "real" index state. We only mark it `degraded`
      // when the indexer itself stamped status='degraded'|'failed' (e.g. the
      // graph fell over). 'partial' is still a working index — no degraded flag.
      const isDegraded = row.status === 'degraded' || row.status === 'failed';
      return {
        repoId,
        status: row.status as IndexStatus,
        filesIndexed: row.filesIndexed,
        filesSkipped: row.filesSkipped,
        durationMs,
        reason,
        lastIndexedSha: row.lastIndexedSha,
        indexerVersion: row.indexerVersion,
        updatedAt: row.updatedAt,
        degraded: isDegraded ? true : undefined,
        degradedReason: isDegraded
          ? ((stats.degradedReason as DegradedReason | undefined) ?? 'index_failed')
          : undefined,
      };
    } catch {
      // Table missing / schema drift / connection blip — degrade silently. The
      // facade always has a safe synthesised fallback.
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // T2 indexer-pipeline writes.
  // -------------------------------------------------------------------------

  /** Wipe every cached symbol + reference row for a repo (full-index reset). */
  async deleteAllForRepo(repoId: string): Promise<void> {
    await this.db.delete(t.symbols).where(eq(t.symbols.repoId, repoId));
    await this.db.delete(t.references).where(eq(t.references.repoId, repoId));
  }

  /**
   * Wipe symbols whose `path` is in `paths` and references whose `fromPath`
   * is in `paths`. Used by the incremental indexer before re-parsing a slice.
   * Inline-empty guard keeps the no-op refresh path zero-DB.
   */
  async deleteForFiles(repoId: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.db
      .delete(t.symbols)
      .where(and(eq(t.symbols.repoId, repoId), inArray(t.symbols.path, paths)));
    await this.db
      .delete(t.references)
      .where(
        and(eq(t.references.repoId, repoId), inArray(t.references.fromPath, paths)),
      );
  }

  /** Batched insert into `symbols`. Uses the same chunk size as blast. */
  async insertSymbols(rows: IndexerSymbolRow[]): Promise<void> {
    if (rows.length === 0) return;
    // Clamp the indexed `name` so a pathological multi-KB identifier can't blow
    // the btree row-size limit and crash the indexer (see clampIndexedName).
    const safe = rows.map((r) => ({ ...r, name: clampIndexedName(r.name) }));
    for (let i = 0; i < safe.length; i += INSERT_CHUNK_SIZE) {
      await this.db.insert(t.symbols).values(safe.slice(i, i + INSERT_CHUNK_SIZE));
    }
  }

  /** Batched insert into `references`. */
  async insertReferences(rows: IndexerReferenceRow[]): Promise<void> {
    if (rows.length === 0) return;
    const safe = rows.map((r) => ({ ...r, toSymbol: clampIndexedName(r.toSymbol) }));
    for (let i = 0; i < safe.length; i += INSERT_CHUNK_SIZE) {
      await this.db.insert(t.references).values(safe.slice(i, i + INSERT_CHUNK_SIZE));
    }
  }

  /**
   * Upsert one row of `repo_index_state`. PK = repoId, so this is an
   * `INSERT ... ON CONFLICT (repo_id) DO UPDATE` over the full row.
   * `updated_at` is set by the column default on insert and bumped explicitly
   * on conflict so consumers can see when the indexer last touched the row.
   */
  async upsertIndexState(state: IndexStateUpsert): Promise<void> {
    const now = new Date();
    await this.db
      .insert(t.repoIndexState)
      .values({
        repoId: state.repoId,
        lastIndexedSha: state.lastIndexedSha,
        indexerVersion: state.indexerVersion,
        status: state.status,
        filesIndexed: state.filesIndexed,
        filesSkipped: state.filesSkipped,
        stats: state.stats,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: t.repoIndexState.repoId,
        set: {
          lastIndexedSha: state.lastIndexedSha,
          indexerVersion: state.indexerVersion,
          status: state.status,
          filesIndexed: state.filesIndexed,
          filesSkipped: state.filesSkipped,
          stats: state.stats,
          updatedAt: now,
        },
      });
  }

  /**
   * Touch `updated_at` (and stats) on the existing index-state row WITHOUT
   * changing files/sha/status. Used by the incremental refresh's "sha
   * unchanged" branch (step 2).
   */
  async touchIndexState(repoId: string, stats?: Record<string, unknown>): Promise<void> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (stats) updates.stats = stats;
    await this.db
      .update(t.repoIndexState)
      .set(updates)
      .where(eq(t.repoIndexState.repoId, repoId));
  }

  /** Update only the `lastIndexedSha` (and bump updated_at) — used by
   * incremental when the diff intersection is empty: code didn't change in
   * any indexed extension, but we still want to remember the new sha. */
  async advanceSha(repoId: string, sha: string): Promise<void> {
    await this.db
      .update(t.repoIndexState)
      .set({ lastIndexedSha: sha, updatedAt: new Date() })
      .where(eq(t.repoIndexState.repoId, repoId));
  }

  // -------------------------------------------------------------------------
  // T3 — graph / rank / repo-map / facts writes.
  // -------------------------------------------------------------------------

  /** Replace the whole import-graph for a repo (full index / incremental). */
  async replaceEdges(repoId: string, edges: IndexerEdgeRow[]): Promise<void> {
    await this.db.delete(t.fileEdges).where(eq(t.fileEdges.repoId, repoId));
    if (edges.length === 0) return;
    const rows = edges.map((e) => ({ repoId, fromFile: e.fromFile, toFile: e.toFile }));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
      await this.db.insert(t.fileEdges).values(rows.slice(i, i + INSERT_CHUNK_SIZE));
    }
  }

  /** Replace the whole file_rank table for a repo. */
  async replaceFileRank(repoId: string, rows: IndexerFileRankRow[]): Promise<void> {
    await this.db.delete(t.fileRank).where(eq(t.fileRank.repoId, repoId));
    if (rows.length === 0) return;
    const values = rows.map((r) => ({ repoId, ...r }));
    for (let i = 0; i < values.length; i += INSERT_CHUNK_SIZE) {
      await this.db.insert(t.fileRank).values(values.slice(i, i + INSERT_CHUNK_SIZE));
    }
  }

  /** Replace per-file facts; only rows with at least one endpoint/cron persist. */
  async replaceFileFacts(repoId: string, rows: IndexerFileFactsRow[]): Promise<void> {
    await this.db.delete(t.fileFacts).where(eq(t.fileFacts.repoId, repoId));
    const nonEmpty = rows.filter((r) => r.endpoints.length > 0 || r.crons.length > 0);
    if (nonEmpty.length === 0) return;
    const values = nonEmpty.map((r) => ({
      repoId,
      filePath: r.filePath,
      endpoints: r.endpoints,
      crons: r.crons,
    }));
    for (let i = 0; i < values.length; i += INSERT_CHUNK_SIZE) {
      await this.db.insert(t.fileFacts).values(values.slice(i, i + INSERT_CHUNK_SIZE));
    }
  }

  /**
   * Resolve `references.decl_file` through the import graph (step 5).
   * A reference `(from_path → to_symbol)` resolves to file `F` iff `from_path`
   * imports `F` AND `F` exports a symbol named `to_symbol` — and ONLY when that
   * candidate is unique. 0 or >1 candidates leave `decl_file = NULL` (which is
   * the honest "unresolved" signal, never a nearest-name guess).
   *
   * `reset: true` (incremental) first clears every decl_file so a changed
   * decl-file can't leave a stale resolution behind; full index inserts rows
   * with NULL decl_file already, so reset is unnecessary there.
   *
   * Quoted `"references"` — it's a SQL reserved word. The query is fully
   * parameterised on repoId (no injection surface).
   */
  async resolveReferences(repoId: string, opts: { reset: boolean }): Promise<void> {
    if (opts.reset) {
      await this.db.execute(
        sql`UPDATE "references" SET decl_file = NULL WHERE repo_id = ${repoId}`,
      );
    }
    await this.db.execute(sql`
      WITH cand AS (
        SELECT r.id AS ref_id, e.to_file AS decl
        FROM "references" r
        JOIN file_edges e ON e.repo_id = r.repo_id AND e.from_file = r.from_path
        JOIN symbols s ON s.repo_id = r.repo_id AND s.path = e.to_file
                      AND s.name = r.to_symbol AND s.exported = true
        WHERE r.repo_id = ${repoId}
        GROUP BY r.id, e.to_file
      ),
      uniq AS (
        SELECT ref_id FROM cand GROUP BY ref_id HAVING count(*) = 1
      )
      UPDATE "references" r
      SET decl_file = c.decl
      FROM cand c
      JOIN uniq u ON u.ref_id = c.ref_id
      WHERE r.id = c.ref_id
    `);
  }

  // -------------------------------------------------------------------------
  // T3 — reads (facade + repo-map).
  // -------------------------------------------------------------------------

  /** All import edges for a repo (rank graph build + critical-paths). */
  async getEdges(repoId: string): Promise<IndexerEdgeRow[]> {
    return this.db
      .select({ fromFile: t.fileEdges.fromFile, toFile: t.fileEdges.toFile })
      .from(t.fileEdges)
      .where(eq(t.fileEdges.repoId, repoId));
  }

  /** `{path, percentile}` for the given paths (smart-diff / run-executor). */
  async getFileRankFor(repoId: string, paths: string[]): Promise<FileRankRow[]> {
    if (paths.length === 0) return [];
    return this.db
      .select({ path: t.fileRank.filePath, percentile: t.fileRank.percentile })
      .from(t.fileRank)
      .where(and(eq(t.fileRank.repoId, repoId), inArray(t.fileRank.filePath, paths)));
  }

  /** Top `limit` paths by rank DESC (caller filters tests/configs in JS). */
  async getRankedPaths(
    repoId: string,
    limit: number,
  ): Promise<Array<{ path: string; rank: number }>> {
    return this.db
      .select({ path: t.fileRank.filePath, rank: t.fileRank.rank })
      .from(t.fileRank)
      .where(eq(t.fileRank.repoId, repoId))
      .orderBy(desc(t.fileRank.rank))
      .limit(limit);
  }

  /** Repo-map candidates: symbols with a signature, joined to rank, ordered. */
  async getRepoMapCandidates(repoId: string): Promise<RepoMapCandidateRow[]> {
    return this.db
      .select({
        path: t.symbols.path,
        name: t.symbols.name,
        exported: t.symbols.exported,
        signature: t.symbols.signature,
        rank: t.fileRank.rank,
      })
      .from(t.symbols)
      .innerJoin(
        t.fileRank,
        and(eq(t.fileRank.repoId, t.symbols.repoId), eq(t.fileRank.filePath, t.symbols.path)),
      )
      .where(and(eq(t.symbols.repoId, repoId), isNotNull(t.symbols.signature)))
      .orderBy(
        desc(t.fileRank.rank),
        desc(t.symbols.exported),
        asc(t.symbols.line),
        asc(t.symbols.name),
      );
  }

  /** Full symbol rows (T2 columns) for the given files. */
  async getSymbolRows(repoId: string, paths: string[]): Promise<FullSymbolRow[]> {
    if (paths.length === 0) return [];
    return this.db
      .select({
        path: t.symbols.path,
        name: t.symbols.name,
        kind: t.symbols.kind,
        line: t.symbols.line,
        endLine: t.symbols.endLine,
        exported: t.symbols.exported,
        signature: t.symbols.signature,
      })
      .from(t.symbols)
      .where(and(eq(t.symbols.repoId, repoId), inArray(t.symbols.path, paths)));
  }

  /** Resolved cross-file callers of symbols declared in `declFiles`. */
  async getResolvedCallers(
    repoId: string,
    declFiles: string[],
    names: string[],
  ): Promise<ResolvedCallerRow[]> {
    if (declFiles.length === 0 || names.length === 0) return [];
    return this.db
      .select({
        fromPath: t.references.fromPath,
        toSymbol: t.references.toSymbol,
        line: t.references.line,
        rank: t.fileRank.rank,
      })
      .from(t.references)
      .innerJoin(
        t.fileRank,
        and(
          eq(t.fileRank.repoId, t.references.repoId),
          eq(t.fileRank.filePath, t.references.fromPath),
        ),
      )
      .where(
        and(
          eq(t.references.repoId, repoId),
          inArray(t.references.declFile, declFiles),
          inArray(t.references.toSymbol, names),
        ),
      );
  }

  /** Per-file facts (endpoints/crons) for the given files. */
  async getFileFacts(repoId: string, files: string[]): Promise<IndexerFileFactsRow[]> {
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

  /** Repo-map cache read by PK. */
  async getRepoMapCache(
    repoId: string,
    commitSha: string,
    tokenBudget: number,
  ): Promise<{ mapText: string; tokenCount: number } | null> {
    const [row] = await this.db
      .select({ mapText: t.repoMapCache.mapText, tokenCount: t.repoMapCache.tokenCount })
      .from(t.repoMapCache)
      .where(
        and(
          eq(t.repoMapCache.repoId, repoId),
          eq(t.repoMapCache.commitSha, commitSha),
          eq(t.repoMapCache.tokenBudget, tokenBudget),
        ),
      );
    return row ?? null;
  }

  /** Repo-map cache upsert by (repoId, commitSha, tokenBudget). */
  async putRepoMapCache(
    repoId: string,
    commitSha: string,
    tokenBudget: number,
    mapText: string,
    tokenCount: number,
  ): Promise<void> {
    await this.db
      .insert(t.repoMapCache)
      .values({ repoId, commitSha, tokenBudget, mapText, tokenCount })
      .onConflictDoUpdate({
        target: [t.repoMapCache.repoId, t.repoMapCache.commitSha, t.repoMapCache.tokenBudget],
        set: { mapText, tokenCount, createdAt: new Date() },
      });
  }

  /** Drop the whole repo-map cache for a repo (SHA moved / repo reindex). */
  async deleteRepoMapCache(repoId: string): Promise<void> {
    await this.db.delete(t.repoMapCache).where(eq(t.repoMapCache.repoId, repoId));
  }

  /**
   * Patch facts for a slice of files (incremental): drop the changed files'
   * rows, then insert the non-empty ones. Unchanged files keep their facts.
   */
  async patchFileFacts(
    repoId: string,
    files: string[],
    rows: IndexerFileFactsRow[],
  ): Promise<void> {
    if (files.length > 0) {
      await this.db
        .delete(t.fileFacts)
        .where(and(eq(t.fileFacts.repoId, repoId), inArray(t.fileFacts.filePath, files)));
    }
    const nonEmpty = rows.filter((r) => r.endpoints.length > 0 || r.crons.length > 0);
    if (nonEmpty.length === 0) return;
    const values = nonEmpty.map((r) => ({
      repoId,
      filePath: r.filePath,
      endpoints: r.endpoints,
      crons: r.crons,
    }));
    for (let i = 0; i < values.length; i += INSERT_CHUNK_SIZE) {
      await this.db.insert(t.fileFacts).values(values.slice(i, i + INSERT_CHUNK_SIZE));
    }
  }
}
