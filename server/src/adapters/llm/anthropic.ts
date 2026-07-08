import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  ChatMessage,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import { toJsonSchema, parseWithRepair } from '../../platform/structured.js';
import { estimateCost } from './pricing.js';
import { ExternalServiceError } from '../../platform/errors.js';

const DEFAULT_TIMEOUT = 300_000; // 5 min — large diffs on Claude can take 2–3 min
const DEFAULT_MAX_TOKENS = 4096;
// Review JSON (findings × fields) can easily exceed 4096 tokens on large diffs.
// 8192 is the safe ceiling for all current Anthropic models (haiku/sonnet/opus).
const STRUCTURED_MAX_TOKENS = 8192;

/**
 * Detect Anthropic's "temperature is deprecated for this model" 400 error.
 * Newer models (e.g. claude-sonnet-5, claude-fable-5) reject the `temperature`
 * param entirely; older models (e.g. claude-haiku-4-5) still accept it. We
 * detect this from the error shape rather than hardcoding a model list so the
 * adapter self-heals for any future model that deprecates the param.
 */
function isTemperatureDeprecatedError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status !== 400) return false;
  const body = (err as { error?: unknown })?.error;
  const message = (err as { message?: unknown })?.message;
  const haystack = `${typeof message === 'string' ? message : ''} ${
    body ? JSON.stringify(body) : ''
  }`;
  return /temperature/i.test(haystack);
}

/** Anthropic has no embeddings API; embeddings come from the OpenAI Embedder. */
function splitSystem(messages: ChatMessage[]): {
  system: string;
  rest: Anthropic.MessageParam[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  return { system, rest };
}

/**
 * Anthropic LLMProvider.
 * - listModels: dynamic via GET /models.
 * - completeStructured: FORCED tool-use (single tool, input_schema = our JSON
 *   schema, tool_choice forces it), parse tool_use.input, Zod validate + reprompt.
 * - embed: NOT supported (throws) — use the OpenAI Embedder for vectors.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Wraps `client.messages.create` with a one-shot self-heal retry: if the
   * API rejects `temperature` as deprecated for the requested model (newer
   * models like claude-sonnet-5/claude-fable-5 no longer accept it, while
   * claude-haiku-4-5 still does), strip the param and retry once. Any other
   * error — or a second failure — is rethrown unchanged.
   */
  private async createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    try {
      return await this.client.messages.create(params);
    } catch (err) {
      if (!isTemperatureDeprecatedError(err)) throw err;
      const { temperature: _temperature, ...retryParams } = params;
      return await this.client.messages.create(retryParams);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    return withRetry(async () => {
      // SDK 0.33 exposes models.list()
      const res = await this.client.models.list();
      return res.data.map((m) => ({
        id: m.id,
        provider: 'anthropic' as const,
        label: m.display_name,
      }));
    });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return withRetry(() => withTimeout(this.doComplete(req), req.timeoutMs ?? DEFAULT_TIMEOUT));
  }

  private async doComplete(req: CompletionRequest): Promise<CompletionResult> {
    const { system, rest } = splitSystem(req.messages);
    const res = await this.createMessage({
      model: req.model,
      system: system || undefined,
      messages: rest,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: req.temperature ?? 0.2,
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const tokensIn = res.usage.input_tokens;
    const tokensOut = res.usage.output_tokens;
    return {
      text,
      model: req.model,
      tokensIn,
      tokensOut,
      costUsd: estimateCost(req.model, tokensIn, tokensOut),
    };
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const jsonSchema = toJsonSchema(req.schema, req.schemaName);
    const toolName = req.schemaName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const maxRetries = req.maxRetries ?? 2;
    const { system, rest } = splitSystem(req.messages);
    const messages: Anthropic.MessageParam[] = [...rest];
    let tokensIn = 0;
    let tokensOut = 0;
    let lastRaw = '';
    let lastError = '';

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const res = await withRetry(() =>
        withTimeout(
          this.createMessage({
            model: req.model,
            system: system || undefined,
            messages,
            max_tokens: req.maxTokens ?? STRUCTURED_MAX_TOKENS,
            temperature: req.temperature ?? 0,
            tools: [
              {
                name: toolName,
                description: `Return the result as ${req.schemaName}.`,
                input_schema: jsonSchema.schema as Anthropic.Tool.InputSchema,
              },
            ],
            tool_choice: { type: 'tool', name: toolName },
          }),
          req.timeoutMs ?? DEFAULT_TIMEOUT,
        ),
      );
      tokensIn += res.usage.input_tokens;
      tokensOut += res.usage.output_tokens;

      const toolUse = res.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );
      lastRaw = toolUse ? JSON.stringify(toolUse.input) : '';

      const parsed = parseWithRepair(req.schema, lastRaw);
      if (parsed.ok) {
        return {
          data: parsed.data,
          model: req.model,
          tokensIn,
          tokensOut,
          costUsd: estimateCost(req.model, tokensIn, tokensOut),
          raw: lastRaw,
          attempts: attempt,
        };
      }
      lastError = parsed.error;
      messages.push({ role: 'assistant', content: res.content });
      if (toolUse) {
        // Anthropic requires a tool_result immediately after every tool_use block;
        // a bare text message here produces a 400. Deliver the reprompt as the
        // tool_result content so the turn sequence stays valid.
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result' as const, tool_use_id: toolUse.id, content: parsed.repromptMessage }],
        });
      } else {
        messages.push({ role: 'user', content: parsed.repromptMessage });
      }
    }

    throw new ExternalServiceError(
      `Anthropic structured output failed schema validation: ${lastError}`,
      { raw: lastRaw },
    );
  }

  async embed(): Promise<number[][]> {
    throw new ExternalServiceError(
      'Anthropic does not provide embeddings; use the OpenAI Embedder.',
    );
  }
}
