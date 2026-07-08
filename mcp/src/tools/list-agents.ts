/**
 * Tool: list_agents
 *
 * Descriptor export shape (used by Step 6 server.ts):
 *   export const listAgentsTool = { name, description, inputSchema, annotations, handler }
 *
 * Step 6 registers it via:
 *   server.tool(listAgentsTool.name, listAgentsTool.description, listAgentsTool.inputSchema,
 *               listAgentsTool.annotations, listAgentsTool.handler)
 * or equivalently via server.registerTool(name, { description, inputSchema, annotations }, handler)
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { fetchAgents } from '../api-client.js';
import { projectAgent } from '../format.js';
import { jsonResult, apiErrorResult } from '../result.js';

const description =
  'Lists the review agents configured in this DevDigest workspace. ' +
  'Use it first to obtain a valid `agent_id` before calling `run_agent_on_pr`. ' +
  'Returns each agent\'s id, name, description, provider, model and enabled flag; ' +
  'disabled agents are included. Read-only — it never starts a review.';

/** inputSchema is a ZodRawShape (Record<string, ZodType>) — SDK v1.29.0 convention. */
const inputSchema = {} as const;

const annotations = {
  readOnlyHint: true,
  idempotentHint: true,
} as const;

async function handler(): Promise<CallToolResult> {
  const result = await fetchAgents();
  if (!result.ok) return apiErrorResult(result);
  return jsonResult(result.data.map(projectAgent));
}

/** Descriptor consumed by Step 6 (server.ts). */
export const listAgentsTool = {
  name: 'list_agents',
  description,
  inputSchema,
  annotations,
  handler,
} as const;
