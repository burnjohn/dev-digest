/**
 * Composition root for the DevDigest MCP server.
 *
 * Creates and configures an McpServer instance with all five tools registered.
 * No side effects at import time — call createDevDigestMcpServer() to get the instance.
 * Transport wiring (StdioServerTransport) happens in index.ts.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listAgentsTool } from './tools/list-agents.js';
import { runAgentOnPrTool } from './tools/run-agent-on-pr.js';
import { getFindingsTool } from './tools/get-findings.js';
import { getConventionsTool } from './tools/get-conventions.js';
import { getBlastRadiusTool } from './tools/get-blast-radius.js';

/**
 * Creates a fully configured McpServer with all five DevDigest tools registered.
 * Registration order: list_agents, run_agent_on_pr, get_findings, get_conventions, get_blast_radius.
 */
export function createDevDigestMcpServer(): McpServer {
  const server = new McpServer({ name: 'devdigest', version: '1.0.0' });

  // 1. list_agents
  server.registerTool(
    listAgentsTool.name,
    {
      description: listAgentsTool.description,
      inputSchema: listAgentsTool.inputSchema,
      annotations: listAgentsTool.annotations,
    },
    listAgentsTool.handler,
  );

  // 2. run_agent_on_pr
  server.registerTool(
    runAgentOnPrTool.name,
    {
      description: runAgentOnPrTool.description,
      inputSchema: runAgentOnPrTool.inputSchema,
      annotations: runAgentOnPrTool.annotations,
    },
    runAgentOnPrTool.handler,
  );

  // 3. get_findings
  server.registerTool(
    getFindingsTool.name,
    {
      description: getFindingsTool.description,
      inputSchema: getFindingsTool.inputSchema,
      annotations: getFindingsTool.annotations,
    },
    getFindingsTool.handler,
  );

  // 4. get_conventions
  server.registerTool(
    getConventionsTool.name,
    {
      description: getConventionsTool.description,
      inputSchema: getConventionsTool.inputSchema,
      annotations: getConventionsTool.annotations,
    },
    getConventionsTool.handler,
  );

  // 5. get_blast_radius
  server.registerTool(
    getBlastRadiusTool.name,
    {
      description: getBlastRadiusTool.description,
      inputSchema: getBlastRadiusTool.inputSchema,
      annotations: getBlastRadiusTool.annotations,
    },
    getBlastRadiusTool.handler,
  );

  return server;
}
