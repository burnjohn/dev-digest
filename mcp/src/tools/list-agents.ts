import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiPort } from '../ports.js';
import { registerTool } from './_register.js';
import { ListAgentsInput, ListAgentsOutput } from '../schemas/agents.js';

/**
 * `list_agents()` (ring M4) — the id source REQ-11 exists for: agent ids
 * are uuids and cannot be guessed, so this is the tool a model calls first
 * to obtain a valid `agent` value for `run_agent_on_pr`. Thin by
 * construction: one `ApiPort.listAgents()` call, no filtering, no
 * reordering — `ApiClient.listAgents` (ring M3) already narrows the wire
 * `Agent[]` down to `{id, name, model, enabled}`, so there is nothing left
 * for this handler to do but pass the projection through.
 */

export interface ListAgentsDeps {
  api: ApiPort;
}

/**
 * §5.13.2, copied character for character (D-G). 298 UTF-8 bytes, asserted
 * by `test/tools-read.test.ts`. Do not improve this string.
 */
const DESCRIPTION =
  'List the reviewer agents configured in DevDigest, each with its id, name, model and enabled flag. ' +
  'Call this first to obtain a valid `agent` value for `run_agent_on_pr` — agent ids are uuids and ' +
  "cannot be guessed. Returns one short line per agent; never the agent's system prompt or output schema.";

export function registerListAgents(server: McpServer, deps: ListAgentsDeps): void {
  registerTool(
    server,
    'list_agents',
    {
      title: 'List Agents',
      description: DESCRIPTION,
      inputSchema: ListAgentsInput,
      outputSchema: ListAgentsOutput,
      annotations: { readOnlyHint: true },
    },
    async () => {
      const agents = await deps.api.listAgents();
      return {
        isError: false,
        text: `${agents.length} reviewer agent(s) configured.`,
        structuredContent: { agents },
      };
    },
  );
}
