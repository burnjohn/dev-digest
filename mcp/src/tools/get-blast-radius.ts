/**
 * Tool: get_blast_radius
 *
 * Read-only. Returns blast radius data for a PR backed by the live repo-intel index
 * via `GET /pulls/:id/blast`. Returns `available:false` (with index state) when no
 * data is available; never fabricates an answer.
 *
 * Descriptor export shape (used by Step 6 server.ts):
 *   export const getBlastRadiusTool = { name, description, inputSchema, annotations, handler }
 */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { fetchBlast } from '../api-client.js';
import { projectBlastLive } from '../format.js';
import { apiErrorResult, jsonResult } from '../result.js';

const description =
  'Returns the blast radius of a pull request: which symbols changed, what downstream ' +
  'code depends on them, and which HTTP endpoints or cron jobs are reachable from the ' +
  'changed files. Backed by the live repo-intel index via GET /pulls/:id/blast — no ' +
  'seed data required. When the index is unavailable the tool returns ' +
  '`{ available: false, reason: "...", index: { status, degraded } }` and never fabricates ' +
  'an answer. Use `get_findings` for review verdicts and this tool only for impact mapping. ' +
  'Read-only; takes a `pr_id`.';

/**
 * inputSchema is a ZodRawShape (Record<string, ZodType>) — SDK v1.29.0 convention.
 */
const inputSchema = {
  pr_id: z.string().uuid().describe('PR UUID'),
} as const;

const annotations = {
  readOnlyHint: true,
  idempotentHint: true,
} as const;

async function handler(args: { pr_id: string }): Promise<CallToolResult> {
  const result = await fetchBlast(args.pr_id);
  if (!result.ok) return apiErrorResult(result);

  // projectBlastLive projects BlastResponse to a compact LLM-friendly shape:
  //   available:false → { available:false, reason, index }
  //   available:true  → counts + per-symbol top-5 callers + prior PRs (top 3)
  // Never fabricates — all fields come directly from the live endpoint response.
  return jsonResult(projectBlastLive(result.data));
}

/** Descriptor consumed by server.ts. */
export const getBlastRadiusTool = {
  name: 'get_blast_radius',
  description,
  inputSchema,
  annotations,
  handler,
} as const;
