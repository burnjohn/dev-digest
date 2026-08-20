/**
 * OpenRouterProvider transport behaviour. The provider had no tests at all, and
 * the bug that motivated these — a truncated response body killing a run on
 * first occurrence — lives below the LLMProvider seam every other test mocks.
 *
 * The seam here is the injected `fetch`, so the real SDK response path (and its
 * real error objects) is exercised.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { APIUserAbortError } from 'openai';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

const Schema = z.object({ ok: z.boolean() });

/** node-fetch's shape for a body it could not parse. openai 4.x uses node-fetch. */
function fetchError(type: string) {
  const err = new Error(
    `invalid json response body at https://openrouter.ai/api/v1/chat/completions reason: Unexpected end of JSON input`,
  );
  err.name = 'FetchError';
  (err as Error & { type: string }).type = type;
  return err;
}

function okBody(content: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 },
  };
}

/** Minimal Response the SDK is happy with; `json` may resolve or reject. */
function response(json: () => Promise<unknown>, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: 'OK',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: new Headers({ 'content-type': 'application/json' }),
    json,
    text: async () => JSON.stringify(await json().catch(() => ({}))),
  } as unknown as Response;
}

/** A fetch that plays the given scripted outcomes in order, then repeats the last. */
function scriptedFetch(steps: Array<() => Response>) {
  let i = 0;
  const calls = { count: 0 };
  const fn = async () => {
    calls.count++;
    const step = steps[Math.min(i, steps.length - 1)]!;
    i++;
    return step();
  };
  return { fetch: fn as unknown as never, calls };
}

function provider(fetchImpl: never, over: Record<string, unknown> = {}) {
  return new OpenRouterProvider('test-key', {
    fetch: fetchImpl,
    sleep: async () => {}, // no real backoff in tests
    ...over,
  });
}

function bodyCapturingFetch() {
  const bodies: Array<Record<string, unknown>> = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return response(async () => okBody({ ok: true }));
  }) as unknown as never;
  return { fetch, bodies };
}

const request = {
  model: 'deepseek/deepseek-v4-flash',
  schema: Schema,
  schemaName: 'Probe',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

describe('OpenRouterProvider — transport retry', () => {
  it('survives a truncated body and succeeds on the retry', async () => {
    const { fetch, calls } = scriptedFetch([
      () => response(() => Promise.reject(fetchError('invalid-json'))),
      () => response(async () => okBody({ ok: true })),
    ]);

    const res = await provider(fetch).completeStructured(request);

    expect(res.data).toEqual({ ok: true });
    expect(calls.count).toBe(2);
  });

  it('gives up after the transport budget and surfaces the real error', async () => {
    const { fetch, calls } = scriptedFetch([
      () => response(() => Promise.reject(fetchError('invalid-json'))),
    ]);

    await expect(provider(fetch, { transportRetries: 1 }).completeStructured(request)).rejects.toThrow(
      /invalid json response body/,
    );
    // 1 initial + 1 retry — the budget, not the schema budget.
    expect(calls.count).toBe(2);
  });

  it('does not retry a permanent failure', async () => {
    const { fetch, calls } = scriptedFetch([
      () => response(async () => ({ error: { message: 'bad request' } }), 400),
    ]);

    await expect(provider(fetch).completeStructured(request)).rejects.toThrow();
    // The SDK does not retry a 400 either, so exactly one request.
    expect(calls.count).toBe(1);
  });

  it('keeps the schema budget intact when transport fails first', async () => {
    // One truncated body, then two schema-invalid answers, then a good one.
    // If the budgets shared a counter the run would die before the last answer.
    const { fetch, calls } = scriptedFetch([
      () => response(() => Promise.reject(fetchError('invalid-json'))),
      () => response(async () => okBody({ nope: 1 })),
      () => response(async () => okBody({ nope: 2 })),
      () => response(async () => okBody({ ok: true })),
    ]);

    const res = await provider(fetch).completeStructured({ ...request, maxRetries: 2 });

    expect(res.data).toEqual({ ok: true });
    expect(calls.count).toBe(4);
    // attempts counts SCHEMA attempts only — the transport retry is not one.
    expect(res.attempts).toBe(3);
  });

  it('recognises an SDK-wrapped abort even when the class name is minified', async () => {
    // The package is consumed via an @vercel/ncc bundle, where class names are
    // mangled — a constructor?.name === 'APIUserAbortError' check dies there.
    // Simulate minification by renaming the class, then abort via our timeout
    // in a way the SDK wraps (fetch rejects with a PLAIN error while the
    // request signal is aborted → the SDK throws APIUserAbortError).
    const original = Object.getOwnPropertyDescriptor(APIUserAbortError, 'name')!;
    Object.defineProperty(APIUserAbortError, 'name', { value: 'q', configurable: true });
    try {
      const stalling = (async (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('socket hang up')); // NOT AbortError-shaped
          });
        })) as unknown as never;

      await expect(
        provider(stalling, { timeoutMs: 20, transportRetries: 1 }).completeStructured(request),
      ).rejects.toThrow(/exceeded 20ms on all 2 transport attempt\(s\)/);
    } finally {
      Object.defineProperty(APIUserAbortError, 'name', original);
    }
  });

  it('surfaces the last validation issues and a truncated raw head on terminal schema failure', async () => {
    // Every attempt returns schema-invalid JSON; the terminal error must carry
    // the last Zod issues and the head of the last raw output — these surface
    // into run events and are the recurring live-debug pain (INSIGHTS).
    const { fetch } = scriptedFetch([() => response(async () => okBody({ nope: 1 }))]);

    let thrown: Error | undefined;
    try {
      await provider(fetch).completeStructured({ ...request, maxRetries: 0 });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('failed schema validation for Probe');
    expect(thrown!.message).toMatch(/ok/); // the missing-field issue path
    expect(thrown!.message).toContain('"nope"'); // the raw head
  });

  it('reports a timeout as a timeout, not as a schema failure', async () => {
    // A fetch that never settles until the request signal aborts it.
    const stalling = (async (_url: string, init: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const e = new Error('The user aborted a request.');
          e.name = 'AbortError';
          reject(e);
        });
      })) as unknown as never;

    await expect(
      provider(stalling, { timeoutMs: 20, transportRetries: 1 }).completeStructured(request),
    ).rejects.toThrow(/exceeded 20ms on all 2 transport attempt\(s\)/);
  });
});

describe('OpenRouterProvider — listModels', () => {
  it('routes listModels through the injected fetch, never the global one', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(String(url));
      return response(async () => ({
        data: [
          { id: 'm1', name: 'M1', context_length: 1000, pricing: { prompt: '0.000001', completion: '0.000002' } },
        ],
      }));
    }) as unknown as never;

    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('global fetch must not be used when a test-seam fetch is injected');
    }) as typeof fetch;
    try {
      const models = await provider(fetchImpl).listModels();
      expect(urls.some((u) => u.endsWith('/models'))).toBe(true);
      expect(models[0]).toMatchObject({ id: 'm1', provider: 'openrouter' });
      expect(models[0]!.pricing).toEqual({ promptPerM: 1, completionPerM: 2 });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('OpenRouterProvider — bounded model tuning', () => {
  it('disables hidden reasoning for DeepSeek V4 and sends the completion cap', async () => {
    const { fetch, bodies } = bodyCapturingFetch();

    await provider(fetch).completeStructured({ ...request, maxTokens: 4096 });

    expect(bodies[0]).toMatchObject({
      model: 'deepseek/deepseek-v4-flash',
      max_tokens: 4096,
      reasoning: { enabled: false },
    });
  });

  it('uses bounded low reasoning for GPT-5.6 models', async () => {
    const { fetch, bodies } = bodyCapturingFetch();

    await provider(fetch).completeStructured({
      ...request,
      model: 'openai/gpt-5.6-luna',
      maxTokens: 4096,
    });

    expect(bodies[0]).toMatchObject({
      model: 'openai/gpt-5.6-luna',
      reasoning: { effort: 'low' },
    });
  });

  it('does not send a reasoning field to non-reasoning models', async () => {
    const { fetch, bodies } = bodyCapturingFetch();

    await provider(fetch).completeStructured({
      ...request,
      model: 'qwen/qwen3-coder-next',
      maxTokens: 4096,
    });

    expect(bodies[0]).not.toHaveProperty('reasoning');
  });

  it('honors the request timeout instead of the longer provider default', async () => {
    const stalling = (async (_url: string, init: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const e = new Error('The user aborted a request.');
          e.name = 'AbortError';
          reject(e);
        });
      })) as unknown as never;

    const started = Date.now();
    await expect(
      provider(stalling, { timeoutMs: 5_000, transportRetries: 0 }).completeStructured({
        ...request,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/exceeded 20ms on all 1 transport attempt\(s\)/);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
