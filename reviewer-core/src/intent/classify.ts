import type { Intent, LLMProvider } from '@devdigest/shared';
import { Intent as IntentSchema } from '@devdigest/shared';
import { buildIntentMessages } from './prompt.js';

export interface IntentInput {
  title: string;
  body: string;
  filesSummary: string;
  linkedIssueBody?: string;
  llm: LLMProvider;
  model: string;
  sessionId?: string;
}

/**
 * Classify the intent of a pull request using a cheap LLM pre-pass.
 *
 * Calls the injected LLM with metadata only (no diff body lines) to infer the
 * author's goal, in-scope changes, and what the PR deliberately avoids.
 *
 * This function is pure — zero I/O beyond the injected llm provider.
 *
 * Returns the structured Intent plus token/cost accounting for caller aggregation.
 */
export async function classifyIntent(
  input: IntentInput,
): Promise<Intent & { tokensIn: number; tokensOut: number; costUsd: number | null }> {
  const messages = buildIntentMessages({
    title: input.title,
    body: input.body,
    filesSummary: input.filesSummary,
    linkedIssueBody: input.linkedIssueBody,
  });

  const result = await input.llm.completeStructured<Intent>({
    model: input.model,
    schema: IntentSchema,
    schemaName: 'PRIntent',
    messages,
    maxRetries: 2,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });

  return {
    ...result.data,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
  };
}
