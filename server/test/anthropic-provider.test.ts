import { describe, it, expect, vi } from 'vitest';
import { Review } from '@devdigest/shared';
import { AnthropicProvider } from '../src/adapters/llm/anthropic.js';

/**
 * Newer Anthropic models (claude-sonnet-5, claude-fable-5) reject the
 * `temperature` param with a 400 "temperature is deprecated for this model"
 * error, while older models (claude-haiku-4-5) still accept it. The provider
 * must detect this specific 400 and retry once with `temperature` stripped —
 * any other error (or a second failure) must be rethrown unchanged.
 */

function makeTemperatureDeprecatedError() {
  const err = new Error(
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"`temperature` is deprecated for this model."}}',
  );
  (err as unknown as { status: number }).status = 400;
  (err as unknown as { error: unknown }).error = {
    type: 'invalid_request_error',
    message: '`temperature` is deprecated for this model.',
  };
  return err;
}

function makeUnrelatedBadRequestError() {
  const err = new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens too large"}}');
  (err as unknown as { status: number }).status = 400;
  (err as unknown as { error: unknown }).error = {
    type: 'invalid_request_error',
    message: 'max_tokens too large',
  };
  return err;
}

function fakeMessageResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

function fakeToolUseResult(input: unknown) {
  return fakeMessageResult({
    content: [
      {
        type: 'tool_use',
        id: 'tool_1',
        name: 'Review',
        input,
      },
    ],
  });
}

/** Swap the provider's private `client.messages.create` with a stub. */
function withStubbedCreate(provider: AnthropicProvider, create: (...args: unknown[]) => unknown) {
  (provider as unknown as { client: { messages: { create: unknown } } }).client = {
    messages: { create },
  };
}

describe('AnthropicProvider temperature-deprecation self-heal', () => {
  it('doComplete: strips temperature and retries once on a temperature-deprecated 400', async () => {
    const provider = new AnthropicProvider('test-key');
    const create = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(makeTemperatureDeprecatedError()))
      .mockImplementationOnce(() => Promise.resolve(fakeMessageResult()));
    withStubbedCreate(provider, create);

    const result = await provider.complete({
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.text).toBe('ok');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0]).toHaveProperty('temperature');
    expect(create.mock.calls[1]![0]).not.toHaveProperty('temperature');
  });

  it('completeStructured: first call includes temperature; retries without it on the deprecation 400, and returns the retried result', async () => {
    const provider = new AnthropicProvider('test-key');
    const validInput = {
      verdict: 'approve',
      summary: 'looks fine',
      score: 90,
      findings: [],
    };
    const create = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(makeTemperatureDeprecatedError()))
      .mockImplementationOnce(() => Promise.resolve(fakeToolUseResult(validInput)));
    withStubbedCreate(provider, create);

    const result = await provider.completeStructured({
      model: 'claude-sonnet-5',
      schema: Review,
      schemaName: 'Review',
      messages: [{ role: 'user', content: 'review this' }],
    });

    expect(result.data.verdict).toBe('approve');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0]).toHaveProperty('temperature');
    expect(create.mock.calls[1]![0]).not.toHaveProperty('temperature');
  });

  it('does not retry a non-temperature 400 — rethrows as-is', async () => {
    const provider = new AnthropicProvider('test-key');
    const err = makeUnrelatedBadRequestError();
    const create = vi.fn().mockImplementation(() => Promise.reject(err));
    withStubbedCreate(provider, create);

    await expect(
      provider.completeStructured({
        model: 'claude-sonnet-5',
        schema: Review,
        schemaName: 'Review',
        messages: [{ role: 'user', content: 'review this' }],
      }),
    ).rejects.toBe(err);

    // only the one call — no strip-and-retry for an unrelated 400
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-400 error (e.g. 500) at the temperature-strip helper level — rethrows as-is', async () => {
    // Use completeStructured's per-attempt call directly rather than complete(),
    // since complete() wraps doComplete in withRetry, which legitimately retries
    // 5xx errors for transient-failure resilience (a separate, correct concern
    // from the temperature-strip self-heal this test targets).
    const provider = new AnthropicProvider('test-key');
    const err = new Error('internal server error');
    (err as unknown as { status: number }).status = 500;
    const create = vi.fn().mockImplementation(() => Promise.reject(err));
    withStubbedCreate(provider, create);

    const createMessage = (
      provider as unknown as {
        createMessage: (params: unknown) => Promise<unknown>;
      }
    ).createMessage.bind(provider);

    await expect(createMessage({ model: 'claude-sonnet-5', temperature: 0 })).rejects.toBe(err);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
