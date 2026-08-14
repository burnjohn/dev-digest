/**
 * repo-intel pipeline — `runFullIndex`.
 *
 * One-pass full index of a repo. Drives:
 *   1. walk + filter           (pipeline/walk.ts)
 *   2. parse (ast-grep, parallel via p-queue, per-file watchdog) + facts
 *   3. delete-and-rewrite the cached symbols/references for this repo
 *      (idempotent — re-running is safe; UNIQUE constraint guards dup rows)
 *   4. [T3] graph (dependency-cruiser) → resolve decl_file → rank (PageRank)
 *      → repo-map render → file_facts
 *   5. upsert `repo_index_state` (status='full' on a clean pass)
 *
 * Soft budget self-watch: JobRunner wraps the handler in
 * `withTimeout(120s)` and rejects → `failed`+retry on hit.
 * The handler can't catch its own outer timeout, so we self-monitor
 * `INDEX_SOFT_BUDGET_MS ≈ 110s` and finish 'partial' BEFORE the hard cap.
 *
 * Option B: rank = PageRank only, hotness=0 (clone is shallow). The T3
 * block is skipped when the soft budget trips, leaving status 'partial'.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join } from 'node:path';
import PQueue from 'p-queue';
import type { RepoRef } from '@devdigest/shared';
import type { Container } from '../../../platform/container.js';
import { withTimeout } from '../../../platform/resilience.js';
import { parseSymbols, parseReferences, langForFile } from '../../../adapters/astgrep/index.js';
import { extractEndpoints, extractCrons } from '../../../adapters/codeindex/extract.js';
import {
  DEFAULT_REPO_MAP_TOKEN_BUDGET,
  INDEX_SOFT_BUDGET_MS,
  INDEXER_VERSION,
  MAX_PARSE_MS_PER_FILE,
} from '../constants.js';
import type {
  IndexerEdgeRow,
  IndexerFileFactsRow,
  IndexerReferenceRow,
  IndexerSymbolRow,
  RepoIntelRepository,
} from '../repository.js';
import type { IndexResult, IndexStatus } from '../types.js';
import { walkClone } from './walk.js';
import { computeFileRank } from './rank.js';
import { renderRepoMap } from './repo-map.js';

export interface IndexPayload {
  repoId: string;
  /** Optional ref hint — when omitted we look up the repo's owner/name from the DB. */
  owner?: string;
  name?: string;
}

/** Per-file parse error captured into `stats.parseDegraded` (capped). */
interface ParseDegradedEntry {
  file: string;
  reason: string;
}

/** Hard cap on `stats.parseDegraded` so a broken clone can't blow up jsonb. */
const PARSE_DEGRADED_CAP = 50;

/**
 * Full index of one repo. Returns the final IndexResult so the caller can
 * report it (job ack, HTTP response). Errors that abort the whole run still
 * stamp a `status='failed'` row before re-throwing — the handler is
 * idempotent on retry.
 */
export async function runFullIndex(
  container: Container,
  repository: RepoIntelRepository,
  payload: IndexPayload,
): Promise<IndexResult> {
  const startedAt = Date.now();
  const repoId = payload.repoId;

  const repo = await repository.getRepoBasics(repoId);
  if (!repo) {
    // Repo deleted between enqueue and run — no-op, no row to write to.
    return degradedResult(startedAt, 'repo_not_found');
  }
  const clonePath = repo.clonePath;
  if (!clonePath) {
    // Clone hasn't completed yet (race against runCloneJob) — bail and let
    // the next enqueue (after clone) populate the index. Persist a row so
    // observability can see why no index exists.
    await safePersist(repository, repoId, '', 'degraded', 0, 0, {
      reason: 'no_clone',
      degradedReason: 'no_data',
      durationMs: Date.now() - startedAt,
    });
    return degradedResult(startedAt, 'no_clone');
  }

  const ref: RepoRef = { owner: repo.owner, name: repo.name };
  const currentSha = await safeCurrentHead(container, ref);

  // Walk + filter -------------------------------------------------------
  const walk = await walkClone(clonePath);
  if (walk.files.length === 0) {
    await safePersist(repository, repoId, currentSha, 'partial', 0, walk.stats.skippedTooLarge, {
      ...walk.stats,
      reason: 'no_files',
      durationMs: Date.now() - startedAt,
    });
    return {
      status: 'partial',
      filesIndexed: 0,
      filesSkipped: walk.stats.skippedTooLarge,
      durationMs: Date.now() - startedAt,
      reason: 'no_files',
    };
  }

  // Parse phase ---------------------------------------------------------
  const symbolsBuf: IndexerSymbolRow[] = [];
  const refsBuf: IndexerReferenceRow[] = [];
  const factsBuf: IndexerFileFactsRow[] = [];
  const parseDegraded: ParseDegradedEntry[] = [];
  let filesIndexed = 0;
  let filesSkipped = walk.stats.skippedTooLarge;
  let softBudgetReached = false;

  const concurrency = Math.max(1, cpus().length - 1);
  const parseQ = new PQueue({ concurrency });

  for (const relPath of walk.files) {
    // Soft-budget gate: before enqueuing each file, bail out if we've burned
    // the budget. Anything still in flight is awaited via `onIdle()` below.
    if (Date.now() - startedAt > INDEX_SOFT_BUDGET_MS) {
      softBudgetReached = true;
      break;
    }

    void parseQ.add(async () => {
      const lang = langForFile(relPath);
      if (!lang) {
        filesSkipped += 1;
        return;
      }
      let source: string;
      try {
        source = await readFile(join(clonePath, relPath), 'utf8');
      } catch (err) {
        filesSkipped += 1;
        recordParseDegraded(parseDegraded, relPath, asMessage(err));
        return;
      }
      const contentHash = sha1(source);
      // Per-file watchdog — a single pathological file shouldn't burn the
      // whole budget. parseSymbols/References are synchronous, so we wrap
      // them in Promise.resolve and race the timeout.
      try {
        const parsed = await withTimeout(
          Promise.resolve().then(() => ({
            symbols: parseSymbols(relPath, source),
            references: parseReferences(relPath, source),
          })),
          MAX_PARSE_MS_PER_FILE,
        );
        for (const s of parsed.symbols) {
          symbolsBuf.push({
            repoId,
            path: relPath,
            name: s.name,
            kind: s.kind,
            line: s.line,
            endLine: s.endLine,
            exported: s.exported,
            signature: s.signature,
            contentHash,
          });
        }
        for (const r of parsed.references) {
          refsBuf.push({
            repoId,
            fromPath: relPath,
            toSymbol: r.toSymbol,
            line: r.line,
            contentHash,
          });
        }
        // Per-file facts (endpoints/crons) so blast reads from file_facts
        // instead of re-parsing the clone (T3 blast migration).
        const endpoints = extractEndpoints(source);
        const crons = extractCrons(source);
        if (endpoints.length > 0 || crons.length > 0) {
          factsBuf.push({ filePath: relPath, endpoints, crons });
        }
        filesIndexed += 1;
      } catch (err) {
        filesSkipped += 1;
        recordParseDegraded(parseDegraded, relPath, asMessage(err));
      }
    });
  }

  await parseQ.onIdle();

  // Persist phase -------------------------------------------------------
  // Delete-then-insert is the idempotent shape blast already uses. Keeps
  // the new UNIQUE index (symbols_repo_path_name_kind_line_uq) happy.
  await repository.deleteAllForRepo(repoId);
  await repository.insertSymbols(symbolsBuf);
  await repository.insertReferences(refsBuf);

  // --- T3: graph → resolve → rank → repo-map → facts -------------------
  // Skipped when the soft budget tripped: we're already over time, and the
  // graph build would blow past the hard cap. status then stays 'partial'.
  let graphFailed: string | undefined;
  let edgeRows: IndexerEdgeRow[] = [];
  let rankCount = 0;
  if (!softBudgetReached) {
    try {
      const edges = await container.depgraph.buildEdges(clonePath, walk.files);
      edgeRows = edges.map((e) => ({ fromFile: e.from, toFile: e.to }));
    } catch (err) {
      graphFailed = asMessage(err);
    }
    await repository.replaceEdges(repoId, edgeRows);

    // Resolve references.decl_file via the fresh graph. Full index inserts
    // rows with NULL decl_file, so no reset is needed (step 5).
    await repository.resolveReferences(repoId, { reset: false });

    // Rank (PageRank only; hotness=0 — Option B).
    const rankRows = computeFileRank(walk.files, edgeRows);
    rankCount = rankRows.length;
    await repository.replaceFileRank(repoId, rankRows);

    // Repo-map render → cache. Drop stale entries (prior SHAs) first.
    const candidates = await repository.getRepoMapCandidates(repoId);
    const map = renderRepoMap(candidates, container.tokenizer, DEFAULT_REPO_MAP_TOKEN_BUDGET);
    await repository.deleteRepoMapCache(repoId);
    if (currentSha) {
      await repository.putRepoMapCache(
        repoId,
        currentSha,
        DEFAULT_REPO_MAP_TOKEN_BUDGET,
        map.text,
        map.tokens,
      );
    }

    // Per-file facts (endpoints/crons) for the blast facade.
    await repository.replaceFileFacts(repoId, factsBuf);
  }

  // Clean pass → 'full'. Any degradation (soft budget, graph failure, or a
  // parse error) keeps it honestly 'partial'.
  const clean = !softBudgetReached && !graphFailed && parseDegraded.length === 0;
  const status: IndexStatus = clean ? 'full' : 'partial';
  const stats: Record<string, unknown> = {
    ...walk.stats,
    filesSeen: walk.files.length,
    symbolsWritten: symbolsBuf.length,
    referencesWritten: refsBuf.length,
    edgesWritten: edgeRows.length,
    ranked: rankCount,
    factsWritten: factsBuf.length,
    hotnessAvailable: false, // Option B — rank = pagerank only
    ...(graphFailed ? { graphFailed } : {}),
    softBudgetReached,
    parseDegraded,
    durationMs: Date.now() - startedAt,
  };

  await repository.upsertIndexState({
    repoId,
    lastIndexedSha: currentSha,
    indexerVersion: INDEXER_VERSION,
    status,
    filesIndexed,
    filesSkipped,
    stats,
  });

  return {
    status,
    filesIndexed,
    filesSkipped,
    durationMs: Date.now() - startedAt,
    reason: softBudgetReached ? 'soft_budget' : graphFailed ? 'graph_failed' : undefined,
  };
}

function recordParseDegraded(buf: ParseDegradedEntry[], file: string, reason: string): void {
  if (buf.length >= PARSE_DEGRADED_CAP) return;
  buf.push({ file, reason });
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

async function safeCurrentHead(container: Container, ref: RepoRef): Promise<string> {
  try {
    return await container.git.currentHead(ref);
  } catch {
    return '';
  }
}

async function safePersist(
  repository: RepoIntelRepository,
  repoId: string,
  sha: string,
  status: 'partial' | 'degraded',
  filesIndexed: number,
  filesSkipped: number,
  stats: Record<string, unknown>,
): Promise<void> {
  try {
    await repository.upsertIndexState({
      repoId,
      lastIndexedSha: sha,
      indexerVersion: INDEXER_VERSION,
      status,
      filesIndexed,
      filesSkipped,
      stats,
    });
  } catch {
    // Persistence failure during early-exit path — never throw out of the
    // top-level handler; the next run will re-stamp the row.
  }
}

function degradedResult(startedAt: number, reason: string): IndexResult {
  return {
    status: 'degraded',
    filesIndexed: 0,
    filesSkipped: 0,
    durationMs: Date.now() - startedAt,
    reason,
  };
}
