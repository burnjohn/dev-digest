import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

/**
 * The real OpenRouter provider lives in @devdigest/reviewer-core (shared with
 * the server). Re-exported here so runner code keeps importing it from './llm'.
 */
export { OpenRouterProvider } from '@devdigest/reviewer-core';

/**
 * Offline provider for the local dev-harness + tests: returns a canned
 * structured value (validated against the request schema) so the runner can be
 * exercised end to end with no API key.
 */
export class MockLLMProvider implements LLMProvider {
  readonly id = 'openrouter' as const;
  constructor(private structured: unknown) {}

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const parsed = req.schema.safeParse(this.structured);
    if (!parsed.success) {
      throw new Error(`MockLLMProvider: canned value does not match ${req.schemaName} schema`);
    }
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      raw: JSON.stringify(this.structured),
      attempts: 1,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('MockLLMProvider only implements completeStructured');
  }
  async embed(_texts: string[]): Promise<number[][]> {
    return [];
  }
}
