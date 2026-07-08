/**
 * Tool: get_conventions
 *
 * Read-only. Returns accepted/verified coding conventions for a repository.
 *
 * Descriptor export shape (used by Step 6 server.ts):
 *   export const getConventionsTool = { name, description, inputSchema, annotations, handler }
 */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { fetchConventions } from '../api-client.js';
import { projectConvention } from '../format.js';
import { apiErrorResult, jsonResult } from '../result.js';

const description =
  'Returns the coding conventions extracted for a repository — evidence-backed rules ' +
  'mined from the codebase. Only accepted/verified conventions are returned; pending ' +
  'and rejected candidates are omitted. Use this to learn a repo\'s house style before ' +
  'reasoning about a review. Read-only; takes a `repo_id`.';

/**
 * inputSchema is a ZodRawShape (Record<string, ZodType>) — SDK v1.29.0 convention.
 */
const inputSchema = {
  repo_id: z.string().uuid().describe('Repo UUID'),
} as const;

const annotations = {
  readOnlyHint: true,
  idempotentHint: true,
} as const;

async function handler(args: { repo_id: string }): Promise<CallToolResult> {
  const result = await fetchConventions(args.repo_id);
  if (!result.ok) return apiErrorResult(result);

  // Filter to only accepted/verified conventions (per plan spec).
  const filtered = result.data.filter(
    (c) => c.status === 'accepted' || c.status === 'verified',
  );

  return jsonResult(filtered.map(projectConvention));
}

/** Descriptor consumed by Step 6 (server.ts). */
export const getConventionsTool = {
  name: 'get_conventions',
  description,
  inputSchema,
  annotations,
  handler,
} as const;
