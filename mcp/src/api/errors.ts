/**
 * Error translation (ring M3) — every failure that can come out of `fetch`
 * (connection refused, a non-2xx response, a malformed body, an aborted
 * request) is translated HERE into one typed `ApiError`, so nothing below
 * this ring ever has to know what a `Response` or a `fetch` `TypeError`
 * looks like (§5.12.2: "SDK error types and raw `Response` objects never
 * escape `api/`" — the server's own rule for adapters, carried over).
 *
 * Every message follows §5.7's catalogue shape: the FIRST sentence names the
 * next action, never a bare status code.
 */

export type ApiErrorKind =
  | 'unreachable'
  | 'http_error'
  | 'invalid_response'
  | 'timeout';

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Minimal shape of `ApiErrorBody` (`{error:{code,message,details?}}`) — read
 *  loosely rather than importing the full contract, since a malformed or
 *  down-level server must not crash the parser that is reporting it. */
interface MaybeApiErrorBody {
  error?: { code?: unknown; message?: unknown };
}

function isMaybeApiErrorBody(value: unknown): value is MaybeApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value;
}

/**
 * Translates a thrown `fetch` failure (connection refused, DNS failure, an
 * aborted `AbortSignal.timeout`) into the "API unreachable" catalogue entry.
 * `apiBaseUrl` is echoed so the message is actionable even when the caller
 * has a non-default `DEVDIGEST_API_URL`.
 */
const TIMEOUT_ERROR_NAMES = new Set(['AbortError', 'TimeoutError']);

export function fromFetchFailure(err: unknown, apiBaseUrl: string): ApiError {
  const isTimeout = err instanceof Error && TIMEOUT_ERROR_NAMES.has(err.name);
  const kind: ApiErrorKind = isTimeout ? 'timeout' : 'unreachable';
  const verb = isTimeout ? 'did not answer in time' : 'is not answering';
  return new ApiError(
    kind,
    `DevDigest API ${verb} at \`${apiBaseUrl}\`. Start it with \`cd server && pnpm dev\`, then retry.`,
    err,
  );
}

/**
 * Translates a non-2xx HTTP response into an `ApiError`. Reads the body as
 * text first (a body can only be consumed once) and attempts to parse it as
 * `ApiErrorBody`; falls back to the raw text, then to the status line, so a
 * response that fails to parse still produces a message rather than throwing
 * a second, more confusing error out of the error handler itself.
 */
export async function fromHttpErrorResponse(response: Response, apiBaseUrl: string): Promise<ApiError> {
  const text = await response.text().catch(() => '');
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  const serverMessage =
    isMaybeApiErrorBody(parsed) && typeof parsed.error?.message === 'string'
      ? parsed.error.message
      : text || `HTTP ${response.status} ${response.statusText}`;

  return new ApiError(
    'http_error',
    `DevDigest API at \`${apiBaseUrl}\` returned an error: ${serverMessage}`,
    parsed,
  );
}

/**
 * Translates a response body `api/client.ts`'s `request()` could not parse as
 * JSON into the "invalid_response" catalogue entry. This fires only on a
 * malformed/unparseable body (the `JSON.parse` in `request()` throwing) —
 * response bodies are NOT validated against any Zod schema today. `request()`
 * casts the parsed JSON straight to `T`; the API is a trusted loopback
 * service (§5.11), so a well-formed body with an unexpected shape passes
 * through silently rather than landing here.
 */
export function fromInvalidResponse(err: unknown, apiBaseUrl: string): ApiError {
  const detail = err instanceof Error ? err.message : String(err);
  return new ApiError(
    'invalid_response',
    `DevDigest API at \`${apiBaseUrl}\` returned a response this server could not parse: ${detail}. ` +
      'The API and mcp/ may be on different versions — restart both with `cd server && pnpm dev`.',
    err,
  );
}
