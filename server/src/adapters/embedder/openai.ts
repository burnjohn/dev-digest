import type { Embedder, LLMProvider } from '@devdigest/shared';

/**
 * OpenAIEmbedder (§5) — text-embedding-3-small, 1536 dims. Delegates to the
 * OpenAI LLMProvider's embed() so there's a single OpenAI client.
 */
export class OpenAIEmbedder implements Embedder {
  readonly dims = 1536;
  constructor(private provider: Pick<LLMProvider, 'embed'>) {}

  async embed(texts: string[]): Promise<number[][]> {
    return this.provider.embed(texts);
  }
}
