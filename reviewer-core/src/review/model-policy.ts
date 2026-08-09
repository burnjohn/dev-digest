type ProviderId = 'openai' | 'anthropic' | 'openrouter';

export const GPT_56_LUNA = 'openai/gpt-5.6-luna';
export const GPT_56_TERRA = 'openai/gpt-5.6-terra';
export const CLAUDE_HAIKU_45 = 'anthropic/claude-haiku-4.5';
export const CLAUDE_SONNET_46 = 'anthropic/claude-sonnet-4.6';

export interface ReviewModelPlan {
  mappers: readonly string[];
  adjudicators: readonly string[];
  mapMaxTokens: number;
  adjudicateMaxTokens: number;
  mapTimeoutMs: number;
  adjudicateTimeoutMs: number;
}

function distinct(models: readonly string[]): string[] {
  return [...new Set(models)];
}

/** Internal execution policy; it is deliberately not a user-facing strategy. */
export function reviewModelPlan(
  provider: ProviderId,
  preferredModel: string,
): ReviewModelPlan {
  const openRouter = provider === 'openrouter';
  return {
    mappers: openRouter
      ? distinct([preferredModel, GPT_56_LUNA, CLAUDE_HAIKU_45])
      : [preferredModel],
    adjudicators: openRouter ? [CLAUDE_SONNET_46, GPT_56_TERRA] : [],
    mapMaxTokens: 4096,
    adjudicateMaxTokens: 4096,
    mapTimeoutMs: 45_000,
    adjudicateTimeoutMs: 60_000,
  };
}
