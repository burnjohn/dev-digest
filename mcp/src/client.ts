/**
 * DevDigestClient — thin typed wrapper over the DevDigest HTTP engine
 * (apps/api). The MCP server and the pre-push CLI both go through this so the
 * tools stay a single, runnable surface that reuses the existing services
 * (no logic is re-implemented here).
 *
 * Base URL: DEVDIGEST_API_BASE env (default http://localhost:3001).
 */
import type { BlastRadius, PrDetail, MemoryItem } from '@devdigest/shared';

export interface DevDigestClientOptions {
  baseUrl?: string;
  /** Optional bearer token if the engine is put behind auth later. */
  token?: string;
}

export class DevDigestClient {
  private baseUrl: string;
  private token?: string;

  constructor(opts: DevDigestClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.DEVDIGEST_API_BASE ?? 'http://localhost:3001').replace(
      /\/$/,
      '',
    );
    this.token = opts.token ?? process.env.DEVDIGEST_TOKEN;
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) detail = body.error.message;
      } catch {
        /* non-json */
      }
      throw new Error(`DevDigest API ${path} failed: ${detail}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** read_pr — full PR detail (diff/files/commits/body/linked issue). */
  readPr(prId: string): Promise<PrDetail> {
    return this.req<PrDetail>(`/pulls/${encodeURIComponent(prId)}`);
  }

  /** blast_radius — changed symbols + downstream callers/endpoints/crons. */
  blastRadius(prId: string): Promise<BlastRadius> {
    return this.req<BlastRadius>(`/pulls/${encodeURIComponent(prId)}/blast`);
  }

  /** read_memory — curated memory items (optional scope/kind filters). */
  readMemory(opts: { scope?: string; kind?: string } = {}): Promise<MemoryItem[]> {
    const q = new URLSearchParams();
    if (opts.scope) q.set('scope', opts.scope);
    if (opts.kind) q.set('kind', opts.kind);
    const qs = q.toString();
    return this.req<MemoryItem[]>(`/memory${qs ? `?${qs}` : ''}`);
  }

  /**
   * grep_repo — code search via the engine's CodeIndex. The engine has no
   * standalone grep endpoint, so we use the blast/symbols surface; for arbitrary
   * patterns the MCP server falls back to a local ripgrep (see grep.ts). This
   * method asks the engine to (re)index/echo a repo's spec/context files.
   */
  listContext(repoId: string): Promise<{ path: string; size: number | null }[]> {
    return this.req(`/repos/${encodeURIComponent(repoId)}/context`);
  }

  /**
   * review_diff — run the Structured Reviewer on a PR. The engine review
   * endpoint streams over SSE; here we kick it off and return the run id(s).
   * The pre-push CLI uses local-diff review (see cli.ts) which posts the
   * working diff for a one-shot structured review.
   */
  runReview(prId: string, body: { agentId?: string; all?: boolean } = { all: true }): Promise<unknown> {
    return this.req(`/pulls/${encodeURIComponent(prId)}/review`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** Generic GET passthrough for ad-hoc tool wiring. */
  get<T>(path: string): Promise<T> {
    return this.req<T>(path);
  }
}
