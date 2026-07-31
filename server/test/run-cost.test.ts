import { describe, it, expect } from 'vitest';
import { runCostUsd } from '../src/modules/reviews/repository/run.repo.js';

describe('runCostUsd (Run Cost Badge — on-read cost)', () => {
  it('known model: cost = tokensIn × in + tokensOut × out (per 1M)', () => {
    // deepseek/deepseek-v4-flash = 0.14 in / 0.28 out per 1M tokens.
    // 1M × 0.14 + 1M × 0.28 = 0.42
    expect(runCostUsd('deepseek/deepseek-v4-flash', 1_000_000, 1_000_000)).toBeCloseTo(0.42, 6);
  });

  it('unknown model → null (never $0.00)', () => {
    expect(runCostUsd('some/unpriced-model', 1000, 1000)).toBeNull();
  });

  it('missing tokens → null (never $0.00)', () => {
    expect(runCostUsd('gpt-4.1', null, 500)).toBeNull();
    expect(runCostUsd('gpt-4.1', 500, null)).toBeNull();
    expect(runCostUsd(null, 500, 500)).toBeNull();
  });

  it('summing multiple runs skips null-cost runs', () => {
    const runs = [
      { model: 'gpt-4.1', tokensIn: 1_000_000, tokensOut: 0 }, // 2.0
      { model: 'unknown', tokensIn: 1_000_000, tokensOut: 0 }, // null → skipped
      { model: 'gpt-4.1', tokensIn: 500_000, tokensOut: 0 }, // 1.0
    ];
    let total: number | null = null;
    for (const r of runs) {
      const c = runCostUsd(r.model, r.tokensIn, r.tokensOut);
      if (c == null) continue;
      total = (total ?? 0) + c;
    }
    expect(total).toBeCloseTo(3.0, 6);
  });
});
