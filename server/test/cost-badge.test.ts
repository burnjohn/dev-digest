import { describe, it, expect } from 'vitest';
import { estimateCost } from '../src/adapters/llm/pricing.js';

/**
 * Cost-badge unit tests — the pure estimateCost() function that drives the
 * COST column on the PR list and the COST stat in the run trace drawer.
 * No DB, no network: just the static pricing table.
 */

describe('estimateCost — known models', () => {
  it('computes cost for gpt-4.1 (in=$2/M, out=$8/M)', () => {
    // 1M in × $2/M + 1M out × $8/M = $10.00
    expect(estimateCost('gpt-4.1', 1_000_000, 1_000_000)).toBeCloseTo(10.0, 9);
  });

  it('computes cost for deepseek/deepseek-v4-flash (in=$0.14/M, out=$0.28/M)', () => {
    // 100k in × $0.14/M + 100k out × $0.28/M = $0.014 + $0.028 = $0.042
    expect(estimateCost('deepseek/deepseek-v4-flash', 100_000, 100_000)).toBeCloseTo(0.042, 9);
  });

  it('weights input and output tokens at their separate per-M rates', () => {
    // gpt-4.1: in=$2/M, out=$8/M
    expect(estimateCost('gpt-4.1', 1_000_000, 0)).toBeCloseTo(2.0, 9);
    expect(estimateCost('gpt-4.1', 0, 1_000_000)).toBeCloseTo(8.0, 9);
  });

  it('returns zero cost for a free model (z-ai/glm-4.7-flash)', () => {
    expect(estimateCost('z-ai/glm-4.7-flash', 999_999, 999_999)).toBe(0);
  });

  it('returns zero when zero tokens are passed (no divide-by-zero)', () => {
    expect(estimateCost('gpt-4.1', 0, 0)).toBe(0);
  });
});

describe('estimateCost — unknown models', () => {
  it('returns null for a model not in the pricing table', () => {
    expect(estimateCost('mystery/model-x', 1_000, 1_000)).toBeNull();
  });

  it('returns null for an empty model string', () => {
    expect(estimateCost('', 1_000, 1_000)).toBeNull();
  });
});

describe('cost aggregation pattern (PR list roll-up)', () => {
  it('sums costs across multiple runs for the same PR, ignoring null-cost models', () => {
    // Mirrors the costByPr accumulation loop in pulls/routes.ts
    const runs = [
      { model: 'gpt-4.1', tokensIn: 1_000_000, tokensOut: 0 },         // $2.00
      { model: 'gpt-4.1', tokensIn: 0, tokensOut: 1_000_000 },         // $8.00
      { model: 'mystery/model', tokensIn: 500_000, tokensOut: 500_000 }, // null — skipped
    ];

    let total: number | null = null;
    for (const run of runs) {
      const cost = estimateCost(run.model, run.tokensIn, run.tokensOut);
      if (cost == null) continue;
      total = (total ?? 0) + cost;
    }

    expect(total).toBeCloseTo(10.0, 9);
  });

  it('leaves total as null when ALL runs have unknown pricing', () => {
    const runs = [{ model: 'ghost/v1', tokensIn: 100, tokensOut: 100 }];
    let total: number | null = null;
    for (const run of runs) {
      const cost = estimateCost(run.model, run.tokensIn, run.tokensOut);
      if (cost == null) continue;
      total = (total ?? 0) + cost;
    }
    expect(total).toBeNull();
  });
});
