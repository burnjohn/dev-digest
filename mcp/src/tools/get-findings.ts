/**
 * Tool: get_findings
 *
 * Read-only. Returns completed reviews for a PR in concise or detailed format.
 *
 * Descriptor export shape (used by Step 6 server.ts):
 *   export const getFindingsTool = { name, description, inputSchema, annotations, handler }
 */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { fetchReviews } from '../api-client.js';
import { conciseReviewSummary, detailedReviewSummary } from '../format.js';
import { apiErrorResult, jsonResult } from '../result.js';

const description =
  'Returns reviews already completed for a pull request, without starting a new run. ' +
  'Use when a review has run and you only need its verdict; use `run_agent_on_pr` to ' +
  'create a new one. Concise mode (default) returns a per-agent verdict, score and ' +
  'findings breakdown; detailed mode adds the finding bodies, paginated. Read-only.';

/**
 * inputSchema is a ZodRawShape (Record<string, ZodType>) — SDK v1.29.0 convention.
 */
const inputSchema = {
  pr_id: z.string().uuid().describe('PR UUID'),
  response_format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe('concise=per-agent summary; detailed=adds finding bodies'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe('Max findings in detailed mode'),
} as const;

const annotations = {
  readOnlyHint: true,
  idempotentHint: true,
} as const;

async function handler(args: {
  pr_id: string;
  response_format: 'concise' | 'detailed';
  limit: number;
}): Promise<CallToolResult> {
  const result = await fetchReviews(args.pr_id);
  if (!result.ok) return apiErrorResult(result);

  const reviews = result.data;

  if (args.response_format === 'detailed') {
    return jsonResult(detailedReviewSummary(reviews, args.limit));
  }

  return jsonResult(conciseReviewSummary(reviews));
}

/** Descriptor consumed by Step 6 (server.ts). */
export const getFindingsTool = {
  name: 'get_findings',
  description,
  inputSchema,
  annotations,
  handler,
} as const;
