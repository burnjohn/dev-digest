/**
 * Infrastructure layer — all HTTP I/O for the MCP server.
 *
 * Contract:
 *  - Never throws. Every function returns a discriminated union.
 *  - All error-body parsing uses Zod safeParse, never parse.
 *  - No imports from server/src/ at runtime. Only `import type` from @devdigest/shared.
 */

import { z } from 'zod';
import { config } from './config.js';
import { withTimeout, withRetry, TimeoutError } from './platform/resilience.js';
import type {
  Agent,
  PrMeta,
  ReviewRunResponse,
  ReviewRecord,
  Convention,
  BlastResponse,
  ApiErrorBody,
} from '@devdigest/shared';

// ---- Local type: RunSummary -----------------------------------------------
// Verified against server/src/modules/reviews/repository/run.repo.ts:77.
// Key is run_id (not id). No verdict field — verdict lives on the review record.
export type RunSummary = {
  run_id: string;
  agent_id: string;
  agent_name: string | null;
  provider: string;
  model: string;
  status: string; // poll until 'done' | 'error'
  error: string | null;
  duration_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  findings_count: number | null;
  grounding: unknown;
  ran_at: string | null;
  score: number | null;
  blockers: unknown;
  cost_usd: number | null;
  findings_breakdown: { critical: number; warning: number; suggestion: number } | null;
};

// ---- Discriminated result type --------------------------------------------
export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; code: string; message: string };
export type ApiResult<T> = ApiOk<T> | ApiErr;

// ---- API error envelope schema (local — validates the { error: { code, message } } shape) ----
const ApiErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

// ---- Error message enrichment ---------------------------------------------
/**
 * Appends actionable hints to API error messages so callers get context.
 * Pure function — no side effects.
 */
export function enrichMessage(code: string, message: string): string {
  if (code === 'network_error') {
    return `DevDigest API is unreachable at ${config.apiUrl}; ensure the server is running`;
  }
  if (code === 'not_found') {
    const lower = message.toLowerCase();
    if (lower.includes('agent')) {
      return message + '; call list_agents to see valid agent IDs';
    }
    if (lower.includes('pr') || lower.includes('pull')) {
      return message + '; verify the pr_id is correct';
    }
    if (lower.includes('repo')) {
      return message + '; verify the repo_id is correct';
    }
  }
  if (code === 'validation_error') {
    return message + '; check that all UUID arguments are valid v4 UUIDs';
  }
  return message;
}

// ---- Internal fetch helper ------------------------------------------------
/**
 * Performs an HTTP call to the DevDigest API.
 * Wraps fetch in withRetry + withTimeout. Never throws — always returns a
 * discriminated union so callers have exhaustive error handling.
 */
async function apiFetch<T>(
  path: string,
  options?: RequestInit,
  timeoutMs = 10_000,
): Promise<ApiResult<T>> {
  const url = config.apiUrl + path;

  let response: Response;
  try {
    response = await withRetry(
      () => withTimeout(fetch(url, options), timeoutMs),
      { retries: 2 },
    );
  } catch (err: unknown) {
    // A timeout means the API IS reachable but slow — do not report it as "unreachable".
    if (err instanceof TimeoutError) {
      return {
        ok: false,
        code: 'timeout',
        message: `DevDigest API did not respond within ${Math.round(timeoutMs / 1000)}s for ${path}; the server is running but busy — try again`,
      };
    }
    const rawMessage =
      err instanceof Error ? err.message : String(err);
    const message = enrichMessage('network_error', rawMessage);
    return { ok: false, code: 'network_error', message };
  }

  if (!response.ok) {
    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '';
    }

    // Try to parse as the structured API error envelope.
    let parsed: z.infer<typeof ApiErrorEnvelope> | null = null;
    if (bodyText) {
      try {
        const json: unknown = JSON.parse(bodyText);
        const result = ApiErrorEnvelope.safeParse(json);
        if (result.success) {
          parsed = result.data;
        }
      } catch {
        // Not valid JSON — fall through to generic error below.
      }
    }

    if (parsed) {
      const code = parsed.error.code;
      const rawMsg = parsed.error.message;
      return { ok: false, code, message: enrichMessage(code, rawMsg) };
    }

    // Fall back to HTTP-level error info.
    const code = 'http_error';
    const rawMsg = response.statusText || `HTTP ${response.status}`;
    return { ok: false, code, message: enrichMessage(code, rawMsg) };
  }

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch (err: unknown) {
    const code = 'parse_error';
    const rawMsg = err instanceof Error ? err.message : 'Failed to parse response body';
    return { ok: false, code, message: enrichMessage(code, rawMsg) };
  }

  return { ok: true, data };
}

// ---- Exported API functions -----------------------------------------------

/** GET /agents → Agent[] */
export async function fetchAgents(): Promise<ApiResult<Agent[]>> {
  return apiFetch<Agent[]>('/agents');
}

/**
 * GET /repos/:repoId/pulls → PrMeta[]
 * Used to validate that a pr_id belongs to a given repo before running a review.
 * Heavy endpoint: the server aggregates findings_breakdown + cost per PR, so a
 * repo with dozens of PRs can take >10s on a cold cache — use a generous timeout.
 */
export async function fetchRepoPulls(repoId: string): Promise<ApiResult<PrMeta[]>> {
  return apiFetch<PrMeta[]>(`/repos/${repoId}/pulls`, undefined, 30_000);
}

/**
 * POST /pulls/:prId/review { agentId } → ReviewRunResponse
 * Triggers a review run for one agent on a PR.
 */
export async function postReview(prId: string, agentId: string): Promise<ApiResult<ReviewRunResponse>> {
  return apiFetch<ReviewRunResponse>(`/pulls/${prId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  });
}

/** GET /pulls/:prId/runs → RunSummary[] */
export async function fetchRuns(prId: string): Promise<ApiResult<RunSummary[]>> {
  return apiFetch<RunSummary[]>(`/pulls/${prId}/runs`);
}

/** GET /pulls/:prId/reviews → ReviewRecord[] */
export async function fetchReviews(prId: string): Promise<ApiResult<ReviewRecord[]>> {
  return apiFetch<ReviewRecord[]>(`/pulls/${prId}/reviews`);
}

/** GET /repos/:repoId/conventions → Convention[] */
export async function fetchConventions(repoId: string): Promise<ApiResult<Convention[]>> {
  return apiFetch<Convention[]>(`/repos/${repoId}/conventions`);
}

/** GET /pulls/:prId/blast → BlastResponse */
export async function fetchBlast(prId: string): Promise<ApiResult<BlastResponse>> {
  return apiFetch<BlastResponse>(`/pulls/${prId}/blast`);
}
