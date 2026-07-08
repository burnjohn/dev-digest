/**
 * Tool: run_agent_on_pr
 *
 * THIN handler — all orchestration is delegated to workflows/run-agent-on-pr.ts.
 *
 * Descriptor export shape (used by Step 6 server.ts):
 *   export const runAgentOnPrTool = { name, description, inputSchema, annotations, handler }
 */

import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { runAgentOnPr } from '../workflows/run-agent-on-pr.js';

const description =
  'Runs one review agent on a pull request and blocks until the review finishes ' +
  '(up to 120 seconds), then returns the completed result. Call `list_agents` first ' +
  'for a valid `agent_id`. Use this to PRODUCE a new review; to read an existing one ' +
  'without re-running, use `get_findings` instead. Returns the run status, verdict, ' +
  'score, findings breakdown and the top findings.';

/**
 * inputSchema is a ZodRawShape (Record<string, ZodType>) — SDK v1.29.0 convention.
 * The SDK wraps this into z.object() internally for validation.
 */
const inputSchema = {
  repo_id: z
    .string()
    .uuid()
    .describe('Repo UUID — used to validate the PR belongs to this repo'),
  pr_id: z.string().uuid().describe('PR UUID to review'),
  agent_id: z.string().uuid().describe('Agent UUID from list_agents'),
} as const;

const annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
} as const;

async function handler(args: {
  repo_id: string;
  pr_id: string;
  agent_id: string;
}): Promise<CallToolResult> {
  return runAgentOnPr(args);
}

/** Descriptor consumed by Step 6 (server.ts). */
export const runAgentOnPrTool = {
  name: 'run_agent_on_pr',
  description,
  inputSchema,
  annotations,
  handler,
} as const;
