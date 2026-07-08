/**
 * Application layer — the only non-trivial orchestration in the MCP server.
 *
 * Exported: runAgentOnPr(args) → CallToolResult
 *
 * Orchestration steps:
 *  1. Validate repo↔PR: fetchRepoPulls → assert pr_id exists
 *  2. postReview → extract run_id from first runs[] entry
 *  3. Poll fetchRuns every 2s until status is 'done' | 'error'
 *  4. fetchReviews → match review by run_id → assemble result
 *
 * The entire orchestration is wrapped in withTimeout(120_000).
 * TimeoutError → informative errorResult with retry hint.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { withTimeout, TimeoutError } from '../platform/resilience.js';
import {
  fetchRepoPulls,
  fetchRuns,
  fetchReviews,
  postReview,
} from '../api-client.js';
import { errorResult, jsonResult, apiErrorResult } from '../result.js';
import { computeBreakdown } from '../format.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runAgentOnPr(args: {
  repo_id: string;
  pr_id: string;
  agent_id: string;
}): Promise<CallToolResult> {
  const { repo_id, pr_id, agent_id } = args;

  try {
    return await withTimeout(orchestrate(repo_id, pr_id, agent_id), 120_000);
  } catch (err: unknown) {
    if (err instanceof TimeoutError) {
      return errorResult(
        'Review timed out after 120s. It may still be running — call get_findings(pr_id) later.',
      );
    }
    // Unexpected errors — surface a generic message, no stack trace.
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(`Unexpected error during review: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Orchestration (runs inside withTimeout)
// ---------------------------------------------------------------------------

async function orchestrate(
  repo_id: string,
  pr_id: string,
  agent_id: string,
): Promise<CallToolResult> {
  // Step 1 — Validate repo↔PR
  const pullsResult = await fetchRepoPulls(repo_id);
  if (!pullsResult.ok) return apiErrorResult(pullsResult);

  const belongs = pullsResult.data.some((p) => p.id != null && p.id === pr_id);
  if (!belongs) {
    return errorResult(
      `PR ${pr_id} does not belong to repo ${repo_id}; verify the identifiers`,
    );
  }

  // Step 2 — Trigger review
  const reviewResult = await postReview(pr_id, agent_id);
  if (!reviewResult.ok) return apiErrorResult(reviewResult);

  const firstRun = reviewResult.data.runs[0];
  if (firstRun === undefined) {
    return errorResult(
      'No run was created — the agent may be disabled or a review may already be running',
    );
  }
  const run_id = firstRun.run_id;

  // Step 3 — Poll until done or error
  let finalStatus = 'pending';
  for (;;) {
    await new Promise<void>((r) => setTimeout(r, 2000));

    const runsResult = await fetchRuns(pr_id);
    if (!runsResult.ok) {
      // Transient fetch error — keep polling (api-client retries internally but
      // the poll itself should be resilient to a single bad response).
      continue;
    }

    const row = runsResult.data.find((r) => r.run_id === run_id);
    if (row === undefined) {
      // Row may not be visible yet — keep polling.
      continue;
    }

    if (row.status === 'done' || row.status === 'error') {
      finalStatus = row.status;
      break;
    }
  }

  // Step 4 — Fetch completed review
  const reviewsResult = await fetchReviews(pr_id);
  if (!reviewsResult.ok) {
    // Run finished but we couldn't fetch reviews — return partial result.
    return jsonResult({
      run_id,
      status: finalStatus,
      note: 'run finished but reviews could not be fetched; call get_findings later',
    });
  }

  // Match review to run by run_id (ReviewRecord.run_id is nullable).
  // Fall back to agent_id match if run_id is not populated yet.
  const review =
    reviewsResult.data.find((r) => r.run_id === run_id) ??
    reviewsResult.data.find((r) => r.agent_id === agent_id);

  if (review === undefined) {
    return jsonResult({
      run_id,
      status: finalStatus,
      note: 'run finished but review not yet persisted; call get_findings later',
    });
  }

  // ReviewRecord has no pre-built breakdown — reuse the pure helper from format.ts.
  const result = {
    run_id,
    status: finalStatus,
    verdict: review.verdict,
    score: review.score,
    findings_breakdown: computeBreakdown(review.findings),
    top_findings: review.findings.slice(0, 10),
  };

  return jsonResult(result);
}
