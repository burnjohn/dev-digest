/**
 * Transport retry for LLM calls.
 *
 * The OpenAI SDK retries on its own, but only for failures it can see: its loop
 * in `makeRequest` inspects the fetch promise and the HTTP status, while the
 * response BODY is read later, in `defaultParseResponse` via APIPromise. So a
 * truncated body — `invalid json response body … Unexpected end of JSON input`
 * — escapes the SDK entirely and kills a run on first occurrence, even though
 * it is plainly transient (sibling agents succeed on the identical prompt in
 * the same second).
 *
 * The engine cannot reuse the server's `withRetry` (server/src/platform/
 * resilience.ts): the dependency arrow is one-way — the CI runner executes
 * reviewer-core standalone — and its status/code predicate would not match this
 * error anyway, which carries neither.
 */

/** Wall-clock delay. Injectable in tests so a retry case costs no real time. */
export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retries AFTER the first attempt, for transport failures only. */
export const DEFAULT_TRANSPORT_RETRIES = 2;

export interface TransportRetryOptions {
  /** Retries AFTER the first attempt. Default 2 → up to 3 requests. */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: Sleep;
  onRetry?: (attempt: number, err: unknown) => void;
  /** Override which errors are worth another attempt. Default: `isTransient`. */
  isRetryable?: (err: unknown) => boolean;
}

/**
 * node-fetch failure types worth another attempt. openai 4.x hardwires
 * node-fetch (`_shims/node-runtime.js`), so a body failure arrives as a
 * `FetchError` with a `type` and — notably — no `status`, `code`, or `cause`.
 * `instanceof` is unavailable without importing node-fetch, so match by name.
 */
const RETRYABLE_FETCH_TYPES = new Set([
  'invalid-json', // body truncated or malformed
  'system', // ECONNRESET & friends
  'body-timeout',
  'premature-close',
]);

/**
 * Is another attempt worth making?
 *
 * Scoped deliberately to the gap the SDK cannot see. Status-based failures
 * (429, 5xx, connection resets) are ALREADY retried inside `makeRequest` up to
 * its own `maxRetries`, so retrying an `APIConnectionError` or `RateLimitError`
 * here would multiply the budgets — three SDK attempts inside three of ours is
 * nine requests for one call. Those arrive already exhausted; let them fail.
 *
 * Aborts are excluded too: our timeout surfaces as one and the caller decides,
 * because it needs a different error message.
 */
/**
 * Message shapes that only network-layer failures produce (undici/node-fetch
 * transport errors and body truncation). A SyntaxError or TypeError WITHOUT one
 * of these (and without a `cause`) is a programming bug — retrying it would
 * re-issue paid requests that can only fail the same way.
 */
const NETWORK_SHAPED_MESSAGE =
  /fetch failed|network|ECONNRESET|ETIMEDOUT|socket|premature close|Unexpected end of JSON input|terminated/i;

function hasNetworkEvidence(e: { message?: string; cause?: unknown }): boolean {
  if (e.cause !== undefined) return true;
  return NETWORK_SHAPED_MESSAGE.test(e.message ?? '');
}

export function isTransient(err: unknown): boolean {
  const e = err as
    | { name?: string; type?: string; status?: number; message?: string; cause?: unknown }
    | null;
  if (!e) return false;

  if (e.name === 'FetchError') return RETRYABLE_FETCH_TYPES.has(e.type ?? '');

  // Fallback for a future SDK on undici/native fetch, where a truncated body is
  // a TypeError with an undici `cause` and a malformed one a bare SyntaxError.
  // Both are body-read failures — but ONLY with network-shaped evidence (an
  // undici `cause` or a transport-error message). Without it, these names are
  // far more likely a programming bug, which must fail fast, not be retried.
  if (e.name === 'SyntaxError') return hasNetworkEvidence(e);
  if (e.name === 'TypeError' && e.status === undefined) return hasNetworkEvidence(e);

  return false;
}

/**
 * Run `fn`, retrying transient transport failures with exponential backoff and
 * jitter. Non-transient errors propagate on the first throw.
 */
export async function withTransportRetry<T>(
  fn: () => Promise<T>,
  opts: TransportRetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? DEFAULT_TRANSPORT_RETRIES;
  const base = opts.baseDelayMs ?? 250;
  const max = opts.maxDelayMs ?? 4000;
  const sleep = opts.sleep ?? defaultSleep;
  const retryable = opts.isRetryable ?? isTransient;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !retryable(err)) throw err;
      opts.onRetry?.(attempt + 1, err);
      await sleep(Math.min(max, base * 2 ** attempt) + Math.random() * base);
    }
  }
  throw lastErr;
}
