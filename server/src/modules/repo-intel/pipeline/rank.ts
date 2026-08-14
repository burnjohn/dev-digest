/**
 * repo-intel pipeline — file ranking (step 6, T3).
 *
 * DECISION (Option B): `rank = pagerank`,
 * `hotness = 0`. The clone is shallow (`CLONE_DEPTH = 1`) so there's no churn
 * window; rather than deepen the clone we drop hotness from v1. The `hotness`
 * column stays at 0 so it can be switched on later without a schema change.
 *
 * Graph: nodes are indexed files; a directed edge `importer → imported` per
 * `file_edges` row. PageRank then accrues to depended-upon ("foundational")
 * files — exactly the "core files everything imports rank high" intuition, and
 * faithful to Aider's repo-map (which ranks by graph, not churn).
 *
 * Pure + deterministic given (files, edges): no DB, no git, no clock.
 */
import Graph from 'graphology';
import { centrality } from 'graphology-metrics';
import type { IndexerEdgeRow, IndexerFileRankRow } from '../repository.js';

/**
 * Compute `file_rank` rows for `files` over the import graph `edges`.
 * Isolated files (no edges) get PageRank's uniform floor; an empty/degenerate
 * graph degrades to a flat ranking rather than throwing.
 */
export function computeFileRank(
  files: string[],
  edges: IndexerEdgeRow[],
): IndexerFileRankRow[] {
  if (files.length === 0) return [];

  const graph = new Graph({ type: 'directed', allowSelfLoops: false, multi: false });
  for (const f of files) graph.mergeNode(f);
  for (const e of edges) {
    if (e.fromFile === e.toFile) continue;
    if (!graph.hasNode(e.fromFile) || !graph.hasNode(e.toFile)) continue;
    graph.mergeEdge(e.fromFile, e.toFile);
  }

  let pr: Record<string, number>;
  try {
    pr = centrality.pagerank(graph) as Record<string, number>;
  } catch {
    // Degenerate graph — fall back to a uniform score so the pipeline still
    // produces a (flat) ranking. stats.graphFailed already records the cause.
    const uniform = 1 / files.length;
    pr = Object.fromEntries(files.map((f) => [f, uniform]));
  }

  const base = files.map((f) => {
    const score = pr[f] ?? 0;
    return { filePath: f, pagerank: score, hotness: 0, rank: score };
  });

  // Percentile via "share of files with rank ≤ this rank" so ties share a
  // value (round to the rightmost position of the tie group). Higher rank →
  // higher percentile; top file → ~100.
  const asc = [...base].sort((a, b) => a.rank - b.rank);
  const n = asc.length;
  const pctByPath = new Map<string, number>();
  for (let i = 0; i < n; ) {
    const head = asc[i];
    if (!head) break;
    const groupRank = head.rank;
    let j = i;
    for (;;) {
      const next = asc[j + 1];
      if (!next || next.rank !== groupRank) break;
      j += 1;
    }
    const pct = Math.round((100 * (j + 1)) / n);
    for (const entry of asc.slice(i, j + 1)) pctByPath.set(entry.filePath, pct);
    i = j + 1;
  }

  return base.map((r) => ({ ...r, percentile: pctByPath.get(r.filePath) ?? 0 }));
}
