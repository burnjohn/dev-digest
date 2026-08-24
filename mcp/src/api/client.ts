import type {
  ActiveRun,
  AgentSummary,
  ApiPort,
  ConventionProjection,
  RepoSummary,
  ReviewProjection,
  RunStatus,
} from '../ports.js';
import type { BlastRadiusResponse, PullLookupResult } from '@devdigest/shared';
import {
  activeRunsUrl,
  agentsUrl,
  blastUrl,
  conventionsUrl,
  lookupPullUrl,
  reposUrl,
  reviewsUrl,
  runsUrl,
  startReviewUrl,
} from './routes.js';
import { fromFetchFailure, fromHttpErrorResponse, fromInvalidResponse } from './errors.js';

/**
 * The one driven adapter (ring M3) — implements `ApiPort` over `fetch`. This
 * is the ONLY ring that may call `fetch` or hold a URL literal beyond
 * `config.ts`'s loopback default (§5.12.2). `rings.test.ts` (this task) is
 * what turns that sentence into an enforced fact rather than a convention.
 *
 * Never constructed at module scope anywhere in the package — the
 * composition root (`server.ts`, M5) builds exactly one instance and wires it
 * into every `Deps` that needs an `ApiPort` (REQ-32). A module-level
 * `export const api = new ApiClient(...)` would be a singleton wearing a
 * container's clothes.
 */

/** Per-request timeout. Independent of REQ-13's run-wait BUDGET — this bounds
 *  one HTTP call, not the whole `run_agent_on_pr` arc, whose own deadline
 *  discipline lives in the waiter (T10, ring M2). */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface ApiClientOptions {
  /** Base URL of the DevDigest API — already validated by `config.ts`. */
  apiBaseUrl: string;
  /** Overridable for tests; production callers take the default. */
  requestTimeoutMs?: number;
  /** Overridable for tests — never anything but the global `fetch` in prod. */
  fetchImpl?: typeof fetch;
}

export class ApiClient implements ApiPort {
  private readonly apiBaseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async lookupPull(repo: string, number: number): Promise<PullLookupResult> {
    return this.request<PullLookupResult>(lookupPullUrl(this.apiBaseUrl, repo, number));
  }

  async listAgents(): Promise<AgentSummary[]> {
    const agents = await this.request<{ id: string; name: string; model: string; enabled: boolean }[]>(
      agentsUrl(this.apiBaseUrl),
    );
    return agents.map((a) => ({ id: a.id, name: a.name, model: a.model, enabled: a.enabled }));
  }

  async listRepos(): Promise<RepoSummary[]> {
    const repos = await this.request<{ id: string; full_name: string }[]>(reposUrl(this.apiBaseUrl));
    return repos.map((r) => ({ id: r.id, full_name: r.full_name }));
  }

  async listActiveRuns(pullId: string): Promise<ActiveRun[]> {
    return this.request<ActiveRun[]>(activeRunsUrl(this.apiBaseUrl, pullId));
  }

  async startReview(pullId: string, agentId: string): Promise<{ runId: string }> {
    const result = await this.request<{ runs: { run_id: string }[] }>(startReviewUrl(this.apiBaseUrl, pullId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    const run = result.runs[0];
    if (!run) {
      throw fromInvalidResponse(new Error('POST /pulls/:id/review returned no runs'), this.apiBaseUrl);
    }
    return { runId: run.run_id };
  }

  async listRuns(pullId: string): Promise<RunStatus[]> {
    const rows = await this.request<{ run_id: string; agent_id: string | null; status: RunStatus['status']; error: string | null }[]>(
      runsUrl(this.apiBaseUrl, pullId),
    );
    return rows.map((r) => ({ run_id: r.run_id, agent_id: r.agent_id, status: r.status, error: r.error }));
  }

  async listReviews(pullId: string): Promise<ReviewProjection[]> {
    const rows = await this.request<ReviewProjection[]>(reviewsUrl(this.apiBaseUrl, pullId));
    return rows.map((r) => ({
      run_id: r.run_id,
      agent_id: r.agent_id,
      agent_name: r.agent_name,
      created_at: r.created_at,
      verdict: r.verdict,
      score: r.score,
      findings: r.findings,
    }));
  }

  async listConventions(repoId: string): Promise<ConventionProjection[]> {
    const result = await this.request<{ candidates: ConventionProjection[] }>(conventionsUrl(this.apiBaseUrl, repoId));
    return result.candidates.map((c) => ({ rule: c.rule, status: c.status }));
  }

  /** `GET /pulls/:id/blast` — returned VERBATIM, same precedent as
   *  `lookupPull` above; the narrowing happens in `shaping/blast.ts` (M2),
   *  never here. */
  async getBlastRadius(pullId: string): Promise<BlastRadiusResponse> {
    return this.request<BlastRadiusResponse>(blastUrl(this.apiBaseUrl, pullId));
  }

  /**
   * The one place a request actually goes out. `AbortSignal.timeout` bounds
   * every call (§5.4's deadline discipline); every failure — connection
   * refused, non-2xx, unparsable body — is translated to a typed `ApiError`
   * before it leaves this method, so nothing above `api/` ever sees a raw
   * `Response`, a `fetch` `TypeError`, or an SDK error class.
   */
  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      throw fromFetchFailure(err, this.apiBaseUrl);
    }

    if (!response.ok) {
      throw await fromHttpErrorResponse(response, this.apiBaseUrl);
    }

    const text = await response.text();
    try {
      return text ? (JSON.parse(text) as T) : (undefined as T);
    } catch (err) {
      throw fromInvalidResponse(err, this.apiBaseUrl);
    }
  }
}
