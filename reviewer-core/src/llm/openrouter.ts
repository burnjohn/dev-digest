import OpenAI, { APIUserAbortError, type ClientOptions as OpenAIClientOptions } from 'openai';
import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';
import { toJsonSchema, parseWithRepair } from './structured.js';
import {
  withTransportRetry,
  isTransient,
  DEFAULT_TRANSPORT_RETRIES,
  type Sleep,
} from './retry.js';

/**
 * The single OpenAI-compatible structured provider, owned by the engine because
 * BOTH consumers need it: the CI runner (the GitHub Action runs reviewer-core
 * directly) and the studio server's openrouter path. Centralizing it here means
 * session grouping, the no-choices guard, request timeouts, and the
 * parse-with-repair loop live in ONE place instead of being duplicated.
 *
 * OpenRouter is OpenAI-compatible, so we drive it with the OpenAI SDK pointed at
 * its baseURL. Only completeStructured is needed by reviewPullRequest; the rest
 * are stubs. Cost attribution is INJECTED (`estimateCost`) so the engine stays
 * free of a pricing table — the server passes its own, the runner passes none.
 */

const NOT_SUPPORTED = 'OpenRouterProvider only implements completeStructured';

/** Default wall-clock budget for a single LLM call. */
export const DEFAULT_TIMEOUT_MS = 90_000;

function openRouterTuning(model: string): Record<string, unknown> {
  if (model.startsWith('deepseek/deepseek-v4')) {
    return { reasoning: { enabled: false } };
  }
  if (model.startsWith('openai/gpt-5.6-')) {
    return { reasoning: { effort: 'low' } };
  }
  return {};
}

/**
 * Did this error come from our own abort signal? The SDK reports a
 * caller-supplied signal as a USER abort and deliberately skips its retries, so
 * the retry for this case has to be ours.
 */
function isAbort(err: unknown): boolean {
  // An abort takes two shapes depending on when it lands. During the body read
  // it stays the raw fetch error (`name === 'AbortError'`); before the headers
  // the SDK catches and wraps it as APIUserAbortError. Crucially, NO openai
  // error class assigns `.name` — every one of them reports 'Error'. The
  // wrapped shape is identified with `instanceof` against the class imported
  // from the SAME 'openai' module instance the client uses — safe, and unlike
  // a constructor?.name string compare it survives minification (the package
  // is consumed via an @vercel/ncc bundle, which mangles class names).
  if (err instanceof APIUserAbortError) return true;
  const e = err as { name?: string } | null;
  if (!e) return false;
  const name = e.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

export interface OpenRouterProviderOptions {
  /** OpenAI-compatible base URL (default: OpenRouter). */
  baseURL?: string;
  /** Provider id for traces/gating (default 'openrouter'). */
  id?: 'openai' | 'openrouter';
  /**
   * Wall-clock budget (ms) for one LLM call, enforced with a request-level
   * AbortSignal. NOT the same as the SDK's `timeout` option: that one only
   * covers time-to-response-headers (it clears its abort timer in a `.finally()`
   * on the fetch promise), and OpenRouter answers 200 immediately, then holds
   * the connection while the upstream model generates. A slow generation
   * therefore hangs forever under the SDK timeout alone.
   */
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * Retries for TRANSPORT failures (truncated body, connection reset, 5xx, our
   * own timeout). Separate from the schema-repair budget on the request.
   */
  transportRetries?: number;
  /** Injected cost estimator; returns USD or null when the model is unknown. */
  estimateCost?: (model: string, tokensIn: number, tokensOut: number) => number | null;
  /** Test seams: a stub fetch and a no-wait sleep. Unset in production. */
  fetch?: OpenAIClientOptions['fetch'];
  sleep?: Sleep;
}

export class OpenRouterProvider implements LLMProvider {
  readonly id: 'openai' | 'openrouter';
  private client: OpenAI;
  private baseURL: string;
  private apiKey: string;
  private estimateCost?: OpenRouterProviderOptions['estimateCost'];
  private timeoutMs: number;
  private transportRetries: number;
  private sleep?: Sleep;
  /** The injected test-seam fetch; ALL raw requests (listModels) must use it too. */
  private fetchImpl?: OpenAIClientOptions['fetch'];

  constructor(apiKey: string, opts: OpenRouterProviderOptions = {}) {
    this.id = opts.id ?? 'openrouter';
    this.apiKey = apiKey;
    this.baseURL = opts.baseURL ?? 'https://openrouter.ai/api/v1';
    this.estimateCost = opts.estimateCost;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.transportRetries = opts.transportRetries ?? DEFAULT_TRANSPORT_RETRIES;
    this.sleep = opts.sleep;
    this.fetchImpl = opts.fetch;
    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      // Bounds time-to-headers only; the real budget is the per-request signal
      // in completeStructured. Kept so a dead connection still fails fast.
      timeout: this.timeoutMs,
      maxRetries: opts.maxRetries ?? 2,
    });
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const jsonSchema = toJsonSchema(req.schema, req.schemaName);
    const maxRetries = req.maxRetries ?? 2;
    const messages = [...req.messages];
    let tokensIn = 0;
    let tokensOut = 0;
    let costFromApi: number | null = null;
    let lastRaw = '';
    let lastIssues = '';
    const requestTimeoutMs = req.timeoutMs ?? this.timeoutMs;

    // Two independent budgets. `maxRetries` belongs to SCHEMA repair: each
    // iteration appends the model's bad output plus a correction and asks
    // again. Transport failures must not eat those attempts — sharing one
    // counter means two timeouts leave a single schema attempt and then report
    // "failed schema validation" for what was really a network problem.
    let transportAttempts = 0;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      let res;
      try {
        res = await withTransportRetry(
          () =>
            this.client.chat.completions.create(
              {
                model: req.model,
                messages,
                temperature: req.temperature ?? 0,
                ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
                ...openRouterTuning(req.model),
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: req.schemaName, schema: jsonSchema.schema, strict: true },
                },
                // OpenRouter session grouping — extra body field (spread is exempt from
                // excess-property checks). Only sent when talking to OpenRouter.
                ...(this.id === 'openrouter' && req.sessionId ? { session_id: req.sessionId } : {}),
                // OpenRouter usage accounting — ask it to return the REAL generation
                // cost (USD) in `usage.cost`, instead of estimating from a price book.
                ...(this.id === 'openrouter' ? { usage: { include: true } } : {}),
              },
              // Two reasons to stop: our timeout (the only thing that actually
              // bounds the call — the SDK's own timer is cleared once the
              // response headers arrive) and the caller cancelling the run.
              // A fresh timeout per attempt; the caller's signal is shared.
              {
                signal: req.signal
                  ? AbortSignal.any([AbortSignal.timeout(requestTimeoutMs), req.signal])
                  : AbortSignal.timeout(requestTimeoutMs),
              },
            ),
          {
            retries: this.transportRetries,
            sleep: this.sleep,
            // Our own timeout counts as transport: the SDK reports a
            // caller-supplied signal as a USER abort and skips its retries.
            // But a CANCELLED run must not be retried — that would re-issue
            // the very request the user just paid to stop.
            isRetryable: (e) => !req.signal?.aborted && (isTransient(e) || isAbort(e)),
            onRetry: () => {
              transportAttempts++;
            },
          },
        );
      } catch (err) {
        // Cancellation surfaces as-is; the caller knows why it aborted and
        // labels the run. Only OUR timeout gets renamed.
        if (req.signal?.aborted) throw err;
        // Name the real cause. Without this a timeout would surface as a bare
        // AbortError, and an exhausted retry as whatever the last attempt threw.
        if (isAbort(err)) {
          throw new Error(
            `OpenRouter call for ${req.schemaName} exceeded ${requestTimeoutMs}ms on all ` +
              `${transportAttempts + 1} transport attempt(s)`,
          );
        }
        throw err;
      }

      // OpenRouter can return HTTP 200 with no `choices` (an upstream provider
      // error / moderation / free-tier limit in the body) — surface it.
      const choice = res.choices?.[0];
      if (!choice) {
        const errMsg = (res as unknown as { error?: { message?: string } }).error?.message;
        throw new Error(`OpenRouter returned no choices for ${req.schemaName}${errMsg ? `: ${errMsg}` : ''}`);
      }
      lastRaw = choice.message?.content ?? '';
      tokensIn += res.usage?.prompt_tokens ?? 0;
      tokensOut += res.usage?.completion_tokens ?? 0;
      // `usage.cost` is an OpenRouter extension (USD), absent from the OpenAI SDK type.
      const apiCost = (res.usage as { cost?: number } | null | undefined)?.cost;
      if (typeof apiCost === 'number') costFromApi = (costFromApi ?? 0) + apiCost;

      const parsed = parseWithRepair(req.schema, lastRaw);
      if (parsed.ok) {
        return {
          data: parsed.data,
          model: req.model,
          tokensIn,
          tokensOut,
          costUsd: costFromApi ?? this.estimateCost?.(req.model, tokensIn, tokensOut) ?? null,
          raw: lastRaw,
          attempts: attempt,
        };
      }
      lastIssues = parsed.error;
      messages.push({ role: 'assistant', content: lastRaw });
      messages.push({ role: 'user', content: parsed.repromptMessage });
    }
    // The terminal message must carry WHAT failed: the last validation issues
    // and a truncated head of the last raw output. It surfaces into run events,
    // and schema failures are the recurring live-debug pain (see INSIGHTS) — a
    // bare "failed schema validation" forces a paid replay just to see why.
    throw new Error(
      `OpenRouter structured output failed schema validation for ${req.schemaName}. ` +
        `Last validation issues:\n${lastIssues}\n` +
        `Last raw output (first 500 chars): ${lastRaw.slice(0, 500)}`,
    );
  }

  /**
   * List models with pricing from the OpenRouter `/models` endpoint (the OpenAI
   * SDK's models.list strips the `pricing` field, so we fetch raw). Prices are
   * converted from per-token to USD per 1M tokens; cheapest output first.
   */
  async listModels(): Promise<ModelInfo[]> {
    // Route through the injected test-seam fetch when present — using the
    // global fetch here would silently bypass the seam every other request
    // honors (and would hit the real network from hermetic tests).
    const doFetch = (this.fetchImpl ?? fetch) as typeof fetch;
    const res = await doFetch(`${this.baseURL}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    const models: ModelInfo[] = (json.data ?? []).map((m) => {
      const prompt = Number(m.pricing?.prompt);
      const completion = Number(m.pricing?.completion);
      // OpenRouter uses -1 as a sentinel for variable-priced router pseudo-models
      // (openrouter/auto etc.) — treat negatives as "unknown" so they don't show
      // as $-1000000 and don't sort to the top of the cheapest list.
      const pricing =
        Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
          ? { promptPerM: prompt * 1_000_000, completionPerM: completion * 1_000_000 }
          : null;
      return {
        id: m.id,
        provider: 'openrouter' as const,
        label: m.name ?? null,
        pricing,
        contextLength: m.context_length ?? null,
      };
    });
    return models.sort(
      (a, b) => (a.pricing?.completionPerM ?? Infinity) - (b.pricing?.completionPerM ?? Infinity),
    );
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error(NOT_SUPPORTED);
  }
  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error(NOT_SUPPORTED);
  }
}
