/**
 * repo-intel pipeline — `runIncremental`.
 *
 * Cheap path the polling/refresh hook takes. Flow:
 *   1. No state row OR indexer-version mismatch → delegate to runFullIndex.
 *   2. `currentSha === lastIndexedSha`            → touch updated_at, exit.
 *   3. `git diff --name-only base..head` ∩ SUPPORTED_EXT
 *        - 0 files → bump lastIndexedSha, exit (code didn't move in a parsed ext).
 *        - >INCREMENTAL_FULL_THRESHOLD → delegate to runFullIndex (cheaper than the slice).
 *      Else: delete the slice's rows + reparse + persist.
 *
 * [T3] After the slice reparse, the graph + rank are rebuilt over the full
 * file set and `decl_file` is re-resolved; the per-commit repo-map cache is
 * invalidated and re-rendered. Option B: rank = PageRank, hotness=0.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { RepoRef } from '@devdigest/shared';
import type { Container } from '../../../platform/container.js';
import { withTimeout } from '../../../platform/resilience.js';
import { parseSymbols, parseReferences, langForFile } from '../../../adapters/astgrep/index.js';
import { extractEndpoints, extractCrons } from '../../../adapters/codeindex/extract.js';
import {
  DEFAULT_REPO_MAP_TOKEN_BUDGET,
  INDEXER_VERSION,
  MAX_PARSE_MS_PER_FILE,
  SUPPORTED_EXT,
} from '../constants.js';
import type {
  IndexerEdgeRow,
  IndexerFileFactsRow,
  IndexerReferenceRow,
  IndexerSymbolRow,
  RepoIntelRepository,
} from '../repository.js';
import type { IndexResult, IndexStatus } from '../types.js';
import { runFullIndex, type IndexPayload } from './full.js';
import { walkClone } from './walk.js';
import { computeFileRank } from './rank.js';
import { renderRepoMap } from './repo-map.js';

/**
 * Threshold above which incremental becomes more expensive than full-index.
 * Tuned against step 4. Held local here (not in constants.ts) so
 * the heuristic can move without churning the public constants module.
 */
const INCREMENTAL_FULL_THRESHOLD = 300;

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_EXT);

export async function runIncremental(
  container: Container,
  repository: RepoIntelRepository,
  payload: IndexPayload,
): Promise<IndexResult> {
  const startedAt = Date.now();
  const repoId = payload.repoId;

  const repo = await repository.getRepoBasics(repoId);
  if (!repo || !repo.clonePath) {
    // No clone yet → nothing to refresh against. The next CLONE job will
    // enqueue a full index; we don't try to fake one here.
    return {
      status: 'degraded',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: Date.now() - startedAt,
      reason: 'no_clone',
    };
  }

  const state = await repository.tryGetIndexState(repoId);

  // (1) No state row OR indexer-version mismatch → full reindex. The version
  //     bumps whenever the parser/schema changes shape; mixing rows from two
  //     versions would corrupt downstream consumers (step 1).
  if (!state || state.indexerVersion !== INDEXER_VERSION) {
    return runFullIndex(container, repository, payload);
  }

  const ref: RepoRef = { owner: repo.owner, name: repo.name };
  let currentSha: string;
  try {
    currentSha = await container.git.currentHead(ref);
  } catch (err) {
    return {
      status: 'degraded',
      filesIndexed: 0,
      filesSkipped: 0,
      durationMs: Date.now() - startedAt,
      reason: `git_head_failed:${asMessage(err)}`,
    };
  }

  // (2) Sha unchanged → just touch updated_at so observers see liveness.
  if (currentSha === state.lastIndexedSha) {
    await repository.touchIndexState(repoId);
    return {
      status: state.status,
      filesIndexed: state.filesIndexed,
      filesSkipped: state.filesSkipped,
      durationMs: Date.now() - startedAt,
      reason: 'sha_unchanged',
    };
  }

  // (3) Compute changed-file intersection.
  let changedAll: string[];
  try {
    changedAll = await container.git.diffNameOnly(ref, state.lastIndexedSha, currentSha);
  } catch {
    // diff failure (shallow clone, missing base, etc.) — fall back to full.
    // The full path is heavier but correct; degrading silently to "no-op" would
    // leave the index drifted from HEAD.
    return runFullIndex(container, repository, payload);
  }
  const changed = changedAll.filter((p) => SUPPORTED_SET.has(extname(p).toLowerCase()));

  if (changed.length === 0) {
    // Code didn't move in a parsed extension — just bump the sha so the next
    // diff baseline is current.
    await repository.advanceSha(repoId, currentSha);
    return {
      status: state.status,
      filesIndexed: state.filesIndexed,
      filesSkipped: state.filesSkipped,
      durationMs: Date.now() - startedAt,
      reason: 'no_supported_changes',
    };
  }

  // (4) Large diff → cheaper to redo a full index than to slice.
  if (changed.length > INCREMENTAL_FULL_THRESHOLD) {
    return runFullIndex(container, repository, payload);
  }

  // (5) Slice path: delete then reparse the changed files.
  const symbolsBuf: IndexerSymbolRow[] = [];
  const refsBuf: IndexerReferenceRow[] = [];
  const factsBuf: IndexerFileFactsRow[] = [];
  let filesIndexed = 0;
  let filesSkipped = 0;
  const parseDegraded: Array<{ file: string; reason: string }> = [];

  for (const relPath of changed) {
    const lang = langForFile(relPath);
    if (!lang) {
      filesSkipped += 1;
      continue;
    }
    let source: string;
    try {
      source = await readFile(join(repo.clonePath, relPath), 'utf8');
    } catch (err) {
      // File was deleted between the diff and the read — count as skipped
      // (its old rows still get cleared below).
      filesSkipped += 1;
      parseDegraded.push({ file: relPath, reason: asMessage(err) });
      continue;
    }
    const contentHash = sha1(source);
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
      const endpoints = extractEndpoints(source);
      const crons = extractCrons(source);
      if (endpoints.length > 0 || crons.length > 0) {
        factsBuf.push({ filePath: relPath, endpoints, crons });
      }
      filesIndexed += 1;
    } catch (err) {
      filesSkipped += 1;
      parseDegraded.push({ file: relPath, reason: asMessage(err) });
    }
  }

  await repository.deleteForFiles(repoId, changed);
  await repository.insertSymbols(symbolsBuf);
  await repository.insertReferences(refsBuf);
  await repository.patchFileFacts(repoId, changed, factsBuf);

  // --- T3: rebuild graph + rank, re-resolve, invalidate the repo-map -----
  // The symbol reparse above is sliced, but the graph + rank are global, so we
  // rebuild them over the full file set (cheap vs. the avoided whole-tree AST
  // parse). A future optimization could patch only the changed files' edges;
  // v1 favours simple correctness.
  let graphFailed: string | undefined;
  let edgeRows: IndexerEdgeRow[] = [];
  try {
    const allFiles = (await walkClone(repo.clonePath)).files;
    const edges = await container.depgraph.buildEdges(repo.clonePath, allFiles);
    edgeRows = edges.map((e) => ({ fromFile: e.from, toFile: e.to }));
    await repository.replaceEdges(repoId, edgeRows);
    // reset: a changed decl-file can invalidate a prior resolution.
    await repository.resolveReferences(repoId, { reset: true });
    const rankRows = computeFileRank(allFiles, edgeRows);
    await repository.replaceFileRank(repoId, rankRows);
    // The repo-map is keyed per commit_sha → prior entries are now stale.
    const candidates = await repository.getRepoMapCandidates(repoId);
    const map = renderRepoMap(candidates, container.tokenizer, DEFAULT_REPO_MAP_TOKEN_BUDGET);
    await repository.deleteRepoMapCache(repoId);
    await repository.putRepoMapCache(
      repoId,
      currentSha,
      DEFAULT_REPO_MAP_TOKEN_BUDGET,
      map.text,
      map.tokens,
    );
  } catch (err) {
    graphFailed = asMessage(err);
  }

  // Keep 'full' only if the prior index was full AND this slice stayed clean.
  const clean = parseDegraded.length === 0 && !graphFailed;
  const status: IndexStatus = clean && state.status === 'full' ? 'full' : 'partial';

  const stats: Record<string, unknown> = {
    incremental: true,
    changedFiles: changed.length,
    symbolsWritten: symbolsBuf.length,
    referencesWritten: refsBuf.length,
    edgesWritten: edgeRows.length,
    hotnessAvailable: false,
    ...(graphFailed ? { graphFailed } : {}),
    parseDegraded,
    durationMs: Date.now() - startedAt,
  };

  // The aggregate filesIndexed counter on `repo_index_state` is the prior
  // count + this slice. Symbols/references for unchanged files are still in
  // the table, so the counter must reflect total coverage.
  const newFilesIndexed = state.filesIndexed + filesIndexed;
  const newFilesSkipped = state.filesSkipped + filesSkipped;

  await repository.upsertIndexState({
    repoId,
    lastIndexedSha: currentSha,
    indexerVersion: INDEXER_VERSION,
    status,
    filesIndexed: newFilesIndexed,
    filesSkipped: newFilesSkipped,
    stats,
  });

  return {
    status,
    filesIndexed,
    filesSkipped,
    durationMs: Date.now() - startedAt,
    reason: 'incremental',
  };
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}
