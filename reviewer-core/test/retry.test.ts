/**
 * isTransient — the transport-retry predicate. Its SyntaxError / TypeError
 * fallback branches (for a future SDK on undici/native fetch) must require
 * NETWORK-SHAPED evidence: without it, any programming bug that throws a bare
 * SyntaxError or a status-less TypeError gets retried with paid requests.
 */
import { describe, it, expect } from 'vitest';
import { isTransient } from '../src/llm/retry.js';

function named(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  const err = new Error(message);
  err.name = name;
  Object.assign(err, extra);
  return err;
}

describe('isTransient — node-fetch shapes (must stay transient)', () => {
  it.each(['invalid-json', 'system', 'body-timeout', 'premature-close'])(
    'FetchError type %s is transient',
    (type) => {
      expect(isTransient(named('FetchError', 'boom', { type }))).toBe(true);
    },
  );

  it('FetchError with an unknown type is not transient', () => {
    expect(isTransient(named('FetchError', 'boom', { type: 'max-redirect' }))).toBe(false);
  });
});

describe('isTransient — SyntaxError requires network-shaped evidence', () => {
  it('a truncated-body SyntaxError (Unexpected end of JSON input) is transient', () => {
    expect(isTransient(new SyntaxError('Unexpected end of JSON input'))).toBe(true);
  });

  it('a SyntaxError with a cause (undici body failure) is transient', () => {
    const err = new SyntaxError('terminated');
    (err as SyntaxError & { cause: unknown }).cause = new Error('other side closed');
    expect(isTransient(err)).toBe(true);
  });

  it('a bare SyntaxError from a programming bug is NOT transient', () => {
    expect(isTransient(new SyntaxError("Unexpected token 'u', \"undefined\" is not valid JSON"))).toBe(
      false,
    );
  });
});

describe('isTransient — TypeError requires network-shaped evidence', () => {
  it("undici's 'fetch failed' TypeError with a cause is transient", () => {
    const err = new TypeError('fetch failed');
    (err as TypeError & { cause: unknown }).cause = named('Error', 'connect ECONNRESET');
    expect(isTransient(err)).toBe(true);
  });

  it('a TypeError with an ECONNRESET-shaped message is transient', () => {
    expect(isTransient(new TypeError('request failed: ECONNRESET'))).toBe(true);
  });

  it('a status-less TypeError from a programming bug is NOT transient', () => {
    expect(isTransient(new TypeError("Cannot read properties of undefined (reading 'foo')"))).toBe(
      false,
    );
  });

  it('a TypeError carrying an HTTP status is never transient', () => {
    expect(isTransient(named('TypeError', 'fetch failed', { status: 500 }))).toBe(false);
  });
});
