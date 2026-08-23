import { describe, it, expect } from 'vitest';
import { clusterFindings } from '../src/modules/reviews/findings-cluster.js';
import type { ClusteredFinding } from '../src/modules/reviews/findings-cluster.js';
import type { FindingRow } from '../src/db/rows.js';

/**
 * `clusterFindings` (AC-18/19/20, `findings-cluster.ts`) is the one piece of
 * "Where agents disagree" that never got unit coverage in the L07 homework —
 * flagged in mentor review. Two findings cluster when `file` matches AND
 * their `[start_line, end_line]` ranges overlap or sit within ±2 lines; every
 * original finding is retained with its agent attribution, never deduped or
 * mutated. `server/INSIGHTS.md` (2026-08-22, two entries) documents a real
 * regression this pinning would have caught: a since-fixed single-pass
 * "merge into first fitting cluster" version stranded finding 10 in its own
 * cluster when items arrived in order `[14, 10, 12]` instead of sorted —
 * order shouldn't matter, because findings arrive from concurrently-
 * executing agents (T5) with no guaranteed line order.
 */

function findingRow(overrides: Partial<FindingRow>): FindingRow {
  return {
    id: 'f1',
    reviewId: 'r1',
    file: 'src/x.ts',
    startLine: 10,
    endLine: 10,
    severity: 'CRITICAL',
    category: 'security',
    title: 'finding',
    rationale: 'r',
    suggestion: null,
    confidence: 0.9,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
    ...overrides,
  } as FindingRow;
}

function item(
  findingOverrides: Partial<FindingRow>,
  agent: { agentId: string | null; agentName: string | null },
): ClusteredFinding {
  return { finding: findingRow(findingOverrides), agentId: agent.agentId, agentName: agent.agentName };
}

describe('clusterFindings', () => {
  it('clusters two findings on the same file whose ranges literally overlap', () => {
    const a = item({ id: 'a', file: 'src/x.ts', startLine: 10, endLine: 15 }, { agentId: 'ag1', agentName: 'Security' });
    const b = item({ id: 'b', file: 'src/x.ts', startLine: 12, endLine: 18 }, { agentId: 'ag2', agentName: 'Performance' });

    const clusters = clusterFindings([a, b]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.file).toBe('src/x.ts');
    expect(clusters[0]!.start_line).toBe(10);
    expect(clusters[0]!.end_line).toBe(18);
    expect(clusters[0]!.findings).toHaveLength(2);
  });

  it('clusters two findings exactly at the ±2-line boundary (AC-18)', () => {
    const a = item({ id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10 }, { agentId: 'ag1', agentName: 'Security' });
    const b = item({ id: 'b', file: 'src/x.ts', startLine: 12, endLine: 12 }, { agentId: 'ag2', agentName: 'Performance' });

    expect(clusterFindings([a, b])).toHaveLength(1);
  });

  it('does NOT cluster findings more than 2 lines apart on the same file', () => {
    const a = item({ id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10 }, { agentId: 'ag1', agentName: 'Security' });
    const b = item({ id: 'b', file: 'src/x.ts', startLine: 13, endLine: 13 }, { agentId: 'ag2', agentName: 'Performance' });

    expect(clusterFindings([a, b])).toHaveLength(2);
  });

  it('never clusters findings from different files, even with identical line ranges', () => {
    const a = item({ id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10 }, { agentId: 'ag1', agentName: 'Security' });
    const b = item({ id: 'b', file: 'src/y.ts', startLine: 10, endLine: 10 }, { agentId: 'ag2', agentName: 'Performance' });

    expect(clusterFindings([a, b])).toHaveLength(2);
  });

  it('merges a proximity chain into ONE cluster regardless of input order (regression: [14,10,12] used to strand 10)', () => {
    const f10 = item({ id: 'f10', file: 'src/x.ts', startLine: 10, endLine: 10 }, { agentId: 'ag1', agentName: 'A' });
    const f12 = item({ id: 'f12', file: 'src/x.ts', startLine: 12, endLine: 12 }, { agentId: 'ag2', agentName: 'B' });
    const f14 = item({ id: 'f14', file: 'src/x.ts', startLine: 14, endLine: 14 }, { agentId: 'ag3', agentName: 'C' });

    const orders = [
      [f10, f12, f14],
      [f14, f10, f12],
      [f12, f14, f10],
    ];

    for (const order of orders) {
      const clusters = clusterFindings(order);
      expect(clusters).toHaveLength(1);
      expect(clusters[0]!.findings.map((f) => f.finding.id).sort()).toEqual(['f10', 'f12', 'f14']);
    }
  });

  it('retains every original finding with its own agent attribution — never dedupes or mutates (AC-19/AC-20)', () => {
    const a = item(
      { id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10, category: 'security', severity: 'CRITICAL' },
      { agentId: 'ag1', agentName: 'Security' },
    );
    const b = item(
      { id: 'b', file: 'src/x.ts', startLine: 11, endLine: 11, category: 'performance', severity: 'SUGGESTION' },
      { agentId: 'ag2', agentName: 'Performance' },
    );

    const [cluster] = clusterFindings([a, b]);
    expect(cluster!.findings).toHaveLength(2);

    const byId = new Map(cluster!.findings.map((f) => [f.finding.id, f]));
    expect(byId.get('a')!.agentId).toBe('ag1');
    expect(byId.get('a')!.finding.category).toBe('security');
    expect(byId.get('b')!.agentId).toBe('ag2');
    expect(byId.get('b')!.finding.category).toBe('performance');
  });

  it('clusters purely on file+line proximity — differing severity/category never blocks or forces a merge', () => {
    const a = item(
      { id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10, severity: 'CRITICAL', category: 'security' },
      { agentId: 'ag1', agentName: 'A' },
    );
    const b = item(
      { id: 'b', file: 'src/x.ts', startLine: 10, endLine: 10, severity: 'SUGGESTION', category: 'style' },
      { agentId: 'ag2', agentName: 'B' },
    );

    expect(clusterFindings([a, b])).toHaveLength(1);
  });

  it('a failed agent contributing zero findings never blocks clustering of the survivors', () => {
    // "Failed agent" corner case: run-executor never produces a
    // ClusteredFinding for an agent whose run failed (no findings exist to
    // cluster for it) — clusterFindings only ever sees whatever the caller
    // collected, so the 2 findings from agents that DID succeed still
    // cluster normally with nothing standing in for the missing third agent.
    const a = item({ id: 'a', file: 'src/x.ts', startLine: 10, endLine: 10 }, { agentId: 'ag1', agentName: 'Security' });
    const b = item({ id: 'b', file: 'src/x.ts', startLine: 11, endLine: 11 }, { agentId: 'ag2', agentName: 'Performance' });

    const clusters = clusterFindings([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.findings).toHaveLength(2);
  });

  it('a single finding produces its own singleton cluster', () => {
    const a = item({ id: 'a' }, { agentId: 'ag1', agentName: 'A' });

    const clusters = clusterFindings([a]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.findings).toHaveLength(1);
  });

  it('empty input produces no clusters', () => {
    expect(clusterFindings([])).toEqual([]);
  });

  it('supports a null agentId/agentName (unattributed finding)', () => {
    const a = item({ id: 'a' }, { agentId: null, agentName: null });

    const [cluster] = clusterFindings([a]);
    expect(cluster!.findings[0]!.agentId).toBeNull();
    expect(cluster!.findings[0]!.agentName).toBeNull();
  });
});
