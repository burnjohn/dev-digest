import { describe, expect, it } from 'vitest';
import {
  CLAUDE_HAIKU_45,
  CLAUDE_SONNET_46,
  GPT_56_LUNA,
  GPT_56_TERRA,
  reviewModelPlan,
} from '../src/review/model-policy.js';

describe('reviewModelPlan', () => {
  it('uses the selected OpenRouter model first, then cross-vendor mapper fallbacks', () => {
    const plan = reviewModelPlan('openrouter', 'deepseek/deepseek-v4-flash');

    expect(plan.mappers).toEqual([
      'deepseek/deepseek-v4-flash',
      GPT_56_LUNA,
      CLAUDE_HAIKU_45,
    ]);
    expect(plan.adjudicators).toEqual([CLAUDE_SONNET_46, GPT_56_TERRA]);
  });

  it('deduplicates Luna when it is already the selected mapper', () => {
    expect(reviewModelPlan('openrouter', GPT_56_LUNA).mappers).toEqual([
      GPT_56_LUNA,
      CLAUDE_HAIKU_45,
    ]);
  });

  it.each(['openai', 'anthropic'] as const)(
    'keeps direct %s providers on their selected model without cross-vendor fallback',
    (provider) => {
      const plan = reviewModelPlan(provider, 'selected-model');

      expect(plan.mappers).toEqual(['selected-model']);
      expect(plan.adjudicators).toEqual([]);
    },
  );

  it('defines bounded map and adjudication requests', () => {
    const plan = reviewModelPlan('openrouter', GPT_56_LUNA);

    expect(plan.mapMaxTokens).toBe(4096);
    expect(plan.adjudicateMaxTokens).toBe(4096);
    expect(plan.mapTimeoutMs).toBeLessThan(90_000);
    expect(plan.adjudicateTimeoutMs).toBeLessThanOrEqual(90_000);
  });
});
