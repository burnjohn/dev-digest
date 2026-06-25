import type { WebFetchClient } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';

/**
 * SSRF-guarded outbound HTTP adapter.
 *
 * Guards enforced (identical to the original safeFetchSkillUrl in skills/routes.ts):
 *   - HTTPS-only (no plain http://, no data:, no javascript:)
 *   - Private/loopback/link-local IP hostnames blocked via regex
 *   - 10-second request timeout via AbortSignal.timeout
 *   - Response must have Content-Type starting with "text/"
 *   - Body capped at ~100KB
 *
 * Residual gap (same as today): DNS-rebinding is not defended — the guard
 * checks the hostname string, not the resolved IP address. This is a known
 * limitation and is out of scope to fix here.
 */
export class WebFetchAdapter implements WebFetchClient {
  async fetch(url: string): Promise<string> {
    if (!url.startsWith('https://')) {
      throw new ValidationError('Only HTTPS URLs are allowed');
    }

    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      throw new ValidationError('Invalid URL');
    }

    const PRIVATE_IP =
      /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;
    if (PRIVATE_IP.test(hostname)) {
      throw new ValidationError('Private and local URLs are not allowed');
    }

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      throw new ValidationError(`Failed to fetch URL: ${msg}`);
    }

    if (!res.ok) {
      throw new ValidationError(`URL returned HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('text/')) {
      throw new ValidationError(
        'URL must return text content (text/plain or text/markdown)',
      );
    }

    const MAX_BYTES = 100_000;
    const reader = res.body?.getReader();
    if (!reader) throw new ValidationError('No response body');

    let total = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new ValidationError('File too large (max 100KB)');
      }
      chunks.push(value);
    }

    return new TextDecoder().decode(Buffer.concat(chunks));
  }
}
