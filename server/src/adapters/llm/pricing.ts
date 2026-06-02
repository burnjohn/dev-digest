/**
 * §11 cost discipline — per-provider/model pricing table (USD per 1M tokens).
 * Unknown models return null cost (explicitly flagged), per spec.
 */
interface Price {
  in: number;
  out: number;
}

const PRICING: Record<string, Price> = {
  // OpenAI (approximate public list prices, USD / 1M tokens)
  'gpt-4.1': { in: 2.0, out: 8.0 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4o': { in: 2.5, out: 10.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
  // Anthropic
  'claude-3-5-sonnet-latest': { in: 3.0, out: 15.0 },
  'claude-3-5-haiku-latest': { in: 0.8, out: 4.0 },
  'claude-3-opus-latest': { in: 15.0, out: 75.0 },
};

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number | null {
  const p = PRICING[model];
  if (!p) return null;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
