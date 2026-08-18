import type { TicketFetcher } from './types.js';

/** Hard cap on returned content — this is a classification signal, not a document viewer. */
const MAX_CONTENT_CHARS = 4000;
const FETCH_TIMEOUT_MS = 5000;

/**
 * Best-effort, unauthenticated HTTP fetch of a ticket/plan URL. No auth in
 * this iteration (BYO-key ticket systems are out of scope) — a private
 * Jira/Linear link simply resolves to `null`, same as any other failure.
 * Never throws: a flaky ticket system must not break PR intent classification.
 */
export class HttpTicketFetcher implements TicketFetcher {
  async resolve(ref: string): Promise<{ content: string } | null> {
    let url: URL;
    try {
      url = new URL(ref);
    } catch {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'text/html,text/plain,application/json' },
      });
      if (!res.ok) return null; // any 4xx/5xx
      const contentType = res.headers.get('content-type') ?? '';
      if (!/^text\/|json/.test(contentType)) return null;
      const raw = await res.text();
      return { content: stripToPlainText(raw).slice(0, MAX_CONTENT_CHARS) };
    } catch {
      return null; // network error, timeout, non-text body, etc.
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Cheap HTML→text for a ticket page fetched with no rendering — strips tags/scripts, collapses whitespace. */
function stripToPlainText(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
