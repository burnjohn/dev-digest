import { describe, it, expect } from 'vitest';
import type { EvalBatchRow, EvalCaseRow, EvalRunRow } from '../src/db/rows.js';
import {
  toBatchRecord,
  isTerminalBatch,
  pickLatestTerminalBatch,
  pickPrecedingTerminalBatch,
  buildDashboardDelta,
  buildAlertBanner,
  buildTrendSeries,
  buildComparisonMetrics,
  buildOwnerDashboard,
  toEvalCaseRecord,
  toEvalCaseRunResult,
} from '../src/modules/evals/helpers.js';

/**
 * SPEC-03 "Dashboard, history and comparison" — AC-29, AC-30, AC-32, AC-33,
 * AC-34, AC-37, AC-71. Hermetic: pure functions, plain `EvalBatchRow`
 * fixtures, no DB.
 */

let seq = 0;
function makeBatch(overrides: Partial<EvalBatchRow> = {}): EvalBatchRow {
  seq += 1;
  return {
    id: overrides.id ?? `batch-${String(seq).padStart(3, '0')}`,
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    ownerVersion: 3,
    runnerAgentId: null,
    runnerAgentVersion: null,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    finishedAt: new Date('2026-01-01T00:05:00.000Z'),
    status: 'succeeded',
    recall: 0.8,
    precision: 0.7,
    citationAccuracy: 0.9,
    casesPassed: 8,
    casesTotal: 10,
    costUsd: 0.12,
    ...overrides,
  } as EvalBatchRow;
}

describe('toBatchRecord', () => {
  it('maps a row to the wire DTO, dropping workspace_id and defaulting null case counts to 0', () => {
    const row = makeBatch({ casesPassed: null, casesTotal: null });

    const dto = toBatchRecord(row);

    expect(dto).not.toHaveProperty('workspace_id');
    expect(dto.cases_passed).toBe(0);
    expect(dto.cases_total).toBe(0);
    expect(dto.id).toBe(row.id);
    expect(dto.started_at).toBe(row.startedAt.toISOString());
    expect(dto.finished_at).toBe(row.finishedAt?.toISOString());
    expect(dto.status).toBe('succeeded');
  });

  it('renders a null finished_at as null, not a coerced date', () => {
    const dto = toBatchRecord(makeBatch({ finishedAt: null, status: 'running' }));
    expect(dto.finished_at).toBeNull();
  });
});

describe('isTerminalBatch / pickLatestTerminalBatch — REQ-30', () => {
  it('treats a running batch (even with a finished_at) as non-terminal', () => {
    const running = makeBatch({ status: 'running' });
    expect(isTerminalBatch(running)).toBe(false);
  });

  it('picks the terminal batch with the greatest finished_at, ignoring a running batch entirely', () => {
    const older = makeBatch({ id: 'b-1', finishedAt: new Date('2026-01-01T00:00:00.000Z') });
    const newer = makeBatch({ id: 'b-2', finishedAt: new Date('2026-01-02T00:00:00.000Z') });
    const inFlight = makeBatch({
      id: 'b-3',
      status: 'running',
      finishedAt: new Date('2026-01-03T00:00:00.000Z'),
    });

    const latest = pickLatestTerminalBatch([older, newer, inFlight]);

    expect(latest?.id).toBe('b-2');
  });

  it('breaks a finished_at tie by the greatest id, never by averaging', () => {
    const sameTime = new Date('2026-01-01T00:00:00.000Z');
    const a = makeBatch({ id: 'batch-aaa', finishedAt: sameTime, recall: 0.5 });
    const b = makeBatch({ id: 'batch-bbb', finishedAt: sameTime, recall: 0.9 });

    const latest = pickLatestTerminalBatch([a, b]);

    // 'batch-bbb' > 'batch-aaa' lexicographically — the tie-break winner.
    expect(latest?.id).toBe('batch-bbb');
    // Never the average of 0.5 and 0.9.
    expect(latest?.recall).not.toBe(0.7);
  });

  it('returns null when no batch is terminal', () => {
    const running = makeBatch({ status: 'running' });
    expect(pickLatestTerminalBatch([running])).toBeNull();
  });
});

describe('pickPrecedingTerminalBatch — REQ-32', () => {
  it('finds the terminal batch immediately before the latest', () => {
    const oldest = makeBatch({ id: 'b-1', finishedAt: new Date('2026-01-01T00:00:00.000Z') });
    const middle = makeBatch({ id: 'b-2', finishedAt: new Date('2026-01-02T00:00:00.000Z') });
    const latest = makeBatch({ id: 'b-3', finishedAt: new Date('2026-01-03T00:00:00.000Z') });

    const preceding = pickPrecedingTerminalBatch([oldest, middle, latest], latest);

    expect(preceding?.id).toBe('b-2');
  });

  it('returns null when the latest batch has no predecessor', () => {
    const only = makeBatch({ id: 'b-1' });
    expect(pickPrecedingTerminalBatch([only], only)).toBeNull();
  });
});

describe('buildDashboardDelta — REQ-32, REQ-71', () => {
  it('computes new - old for every metric when both batches are fully measured', () => {
    const preceding = makeBatch({ recall: 0.5, precision: 0.6, citationAccuracy: 0.7 });
    const latest = makeBatch({ recall: 0.6, precision: 0.55, citationAccuracy: 0.7 });

    const delta = buildDashboardDelta(latest, preceding);

    expect(delta.recall).toBeCloseTo(0.1);
    expect(delta.precision).toBeCloseTo(-0.05);
    expect(delta.citation_accuracy).toBeCloseTo(0);
  });

  it('renders — (null), never a signed zero, when there is no preceding batch', () => {
    const latest = makeBatch();
    const delta = buildDashboardDelta(latest, null);
    expect(delta).toEqual({ recall: null, precision: null, citation_accuracy: null });
  });

  it('REQ-71: a null metric on either side renders — for that metric alone, for all three metrics', () => {
    const preceding = makeBatch({ recall: null, precision: 0.5, citationAccuracy: null });
    const latest = makeBatch({ recall: 0.6, precision: null, citationAccuracy: 0.9 });

    const delta = buildDashboardDelta(latest, preceding);

    expect(delta.recall).toBeNull(); // null on preceding side
    expect(delta.precision).toBeNull(); // null on latest side
    expect(delta.citation_accuracy).toBeNull(); // null on preceding side
  });
});

describe('buildAlertBanner — REQ-33, REQ-71', () => {
  it('emits a banner naming the metric, the fall and the agent version for a fall of exactly 0.02', () => {
    const preceding = makeBatch({ recall: 0.5, ownerVersion: 4 });
    const latest = makeBatch({ recall: 0.48, ownerVersion: 4 });

    const banner = buildAlertBanner(latest, preceding);

    expect(banner).not.toBeNull();
    expect(banner).toContain('Recall');
    expect(banner).toContain('0.02');
    expect(banner).toContain('4');
  });

  it('does not emit a banner for a fall of 0.019', () => {
    const preceding = makeBatch({ recall: 0.5 });
    const latest = makeBatch({ recall: 0.481 });

    expect(buildAlertBanner(latest, preceding)).toBeNull();
  });

  it('is a pure function with no model call: same inputs, same output, deterministic wording', () => {
    const preceding = makeBatch({ precision: 0.9 });
    const latest = makeBatch({ precision: 0.85 });

    const first = buildAlertBanner(latest, preceding);
    const second = buildAlertBanner(latest, preceding);

    expect(first).toBe(second);
    expect(first).not.toContain('false positive slipped in');
  });

  it('never emits a banner when there is no preceding batch', () => {
    expect(buildAlertBanner(makeBatch(), null)).toBeNull();
  });

  it('REQ-71: a null metric on either side is excluded from triggering the banner, for all three metrics', () => {
    // Every metric "falls" numerically-impossible-to-tell because one side is null;
    // none may trigger, proven one metric at a time.
    const recallNull = buildAlertBanner(
      makeBatch({ recall: 0.4 }),
      makeBatch({ recall: null }),
    );
    const precisionNull = buildAlertBanner(
      makeBatch({ precision: null }),
      makeBatch({ precision: 0.9 }),
    );
    const citationNull = buildAlertBanner(
      makeBatch({ citationAccuracy: 0.1 }),
      makeBatch({ citationAccuracy: null }),
    );

    expect(recallNull).toBeNull();
    expect(precisionNull).toBeNull();
    expect(citationNull).toBeNull();
  });
});

describe('buildTrendSeries — REQ-37', () => {
  it('emits three points per row, tagged by metric, in the order the rows were handed', () => {
    const row = makeBatch({ id: 'b-1', recall: 0.5, precision: 0.6, citationAccuracy: 0.7 });

    const points = buildTrendSeries([row]);

    expect(points).toHaveLength(3);
    expect(points.map((p) => p.metric)).toEqual(['recall', 'precision', 'citation_accuracy']);
    expect(points.every((p) => p.batch_id === 'b-1')).toBe(true);
  });

  it('keeps a null metric null in its point rather than 0 or a dropped point', () => {
    const row = makeBatch({ id: 'b-1', recall: null, precision: 0.6, citationAccuracy: null });

    const points = buildTrendSeries([row]);

    expect(points).toHaveLength(3);
    const recallPoint = points.find((p) => p.metric === 'recall');
    const citationPoint = points.find((p) => p.metric === 'citation_accuracy');
    expect(recallPoint?.value).toBeNull();
    expect(citationPoint?.value).toBeNull();
  });

  it('yields an empty array — never undefined — for an empty input', () => {
    const points = buildTrendSeries([]);
    expect(points).toEqual([]);
    expect(points).not.toBeUndefined();
  });
});

describe('buildComparisonMetrics — REQ-34, REQ-71', () => {
  it('carries old, new and delta for each of the four metrics', () => {
    const older = makeBatch({ id: 'b-old', recall: 0.5, precision: 0.6, citationAccuracy: 0.7, costUsd: 1 });
    const newer = makeBatch({ id: 'b-new', recall: 0.6, precision: 0.55, citationAccuracy: 0.7, costUsd: 1.5 });

    const cmp = buildComparisonMetrics(older, newer);

    expect(cmp.older.id).toBe('b-old');
    expect(cmp.newer.id).toBe('b-new');
    expect(cmp.recall).toEqual({ old: 0.5, new: 0.6, delta: 0.09999999999999998 });
    expect(cmp.cost_usd.delta).toBeCloseTo(0.5);
  });

  it('REQ-71: a null metric on either batch renders — (null delta), old/new pass through raw', () => {
    const older = makeBatch({ recall: null, precision: 0.4, citationAccuracy: 0.5 });
    const newer = makeBatch({ recall: 0.6, precision: null, citationAccuracy: 0.5 });

    const cmp = buildComparisonMetrics(older, newer);

    expect(cmp.recall).toEqual({ old: null, new: 0.6, delta: null });
    expect(cmp.precision).toEqual({ old: 0.4, new: null, delta: null });
    expect(cmp.citation_accuracy.delta).toBeCloseTo(0);
  });
});

describe('buildOwnerDashboard — REQ-29 shaping', () => {
  it('carries the latest batch and the three metrics, with no workspace_id anywhere in the shape', () => {
    const older = makeBatch({
      id: 'b-1',
      finishedAt: new Date('2026-01-01T00:00:00.000Z'),
      recall: 0.5,
    });
    const latest = makeBatch({
      id: 'b-2',
      finishedAt: new Date('2026-01-02T00:00:00.000Z'),
      recall: 0.4,
    });

    const dashboard = buildOwnerDashboard({
      ownerKind: 'agent',
      ownerId: 'agent-1',
      casesTotal: 12,
      batches: [older, latest],
      recentBatches: [latest, older],
    });

    expect(JSON.stringify(dashboard)).not.toContain('workspace_id');
    expect(dashboard.latest_batch?.id).toBe('b-2');
    expect(dashboard.delta.recall).toBeCloseTo(-0.1);
    expect(dashboard.recent_batches.map((b) => b.id)).toEqual(['b-2', 'b-1']);
    expect(dashboard.trend.length).toBe(6); // 3 metrics x 2 terminal batches
  });

  it('renders an empty dashboard shape (no batches yet) without throwing', () => {
    const dashboard = buildOwnerDashboard({
      ownerKind: 'agent',
      ownerId: 'agent-2',
      casesTotal: 0,
      batches: [],
      recentBatches: [],
    });

    expect(dashboard.latest_batch).toBeNull();
    expect(dashboard.delta).toEqual({ recall: null, precision: null, citation_accuracy: null });
    expect(dashboard.trend).toEqual([]);
    expect(dashboard.alert).toBeNull();
  });
});

// ===========================================================================
// FIX-5: toEvalCaseRecord / toEvalCaseRunResult — moved from `service.ts`
// ===========================================================================

function makeCaseRow(overrides: Partial<EvalCaseRow> = {}): EvalCaseRow {
  return {
    id: 'case-1',
    workspaceId: 'ws-1',
    ownerKind: 'agent',
    ownerId: 'agent-1',
    name: 'a case',
    inputDiff: 'diff --git a/x b/x',
    inputFiles: null,
    inputMeta: null,
    expectedOutput: [],
    notes: null,
    expectationKind: 'must_not_flag',
    forbiddenRegions: null,
    inputFilename: null,
    ...overrides,
  } as EvalCaseRow;
}

function makeRunRow(overrides: Partial<EvalRunRow> = {}): EvalRunRow {
  return {
    id: 'run-1',
    caseId: 'case-1',
    batchId: null,
    ranAt: new Date('2026-01-01T00:00:00.000Z'),
    actualOutput: [],
    pass: true,
    recall: 1,
    precision: 1,
    citationAccuracy: 1,
    durationMs: 100,
    costUsd: 0.01,
    ...overrides,
  } as EvalRunRow;
}

describe('toEvalCaseRecord', () => {
  it('maps a row to the wire DTO, defaulting nullable jsonb fields', () => {
    const row = makeCaseRow({
      inputDiff: null,
      expectationKind: null,
      expectedOutput: null,
      forbiddenRegions: null,
    });

    const dto = toEvalCaseRecord(row);

    expect(dto.id).toBe('case-1');
    expect(dto.owner_kind).toBe('agent');
    expect(dto.input_diff).toBe('');
    expect(dto.expectation_kind).toBe('must_not_flag');
    expect(dto.expected_output).toEqual([]);
    expect(dto.forbidden_regions).toBeNull();
    expect(dto.filename).toBeNull();
  });
});

describe('toEvalCaseRunResult — FIX-1/REQ-64/REQ-67 ablation derivation', () => {
  it('derives ablation null for an agent-owned run (bare Finding[] actual_output)', () => {
    const row = makeRunRow({ actualOutput: [] });

    const dto = toEvalCaseRunResult(row);

    expect(dto.run_id).toBe('run-1');
    expect(dto.case_id).toBe('case-1');
    expect(dto.ablation).toBeNull();
  });

  it('derives ablation from actual_output shape alone for a skill-owned run — no owner_kind read', () => {
    const skillOutput = {
      with: { recall: 0.9, precision: 0.8, citation_accuracy: 0.7, findings: [] },
      without: { unavailable: 'not_run' },
    };
    const row = makeRunRow({ actualOutput: skillOutput });

    const dto = toEvalCaseRunResult(row);

    expect(dto.ablation).toEqual(skillOutput);
  });
});
