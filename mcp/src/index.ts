#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, ConfigError, type McpConfig } from './config.js';
import { buildServer } from './server.js';

/**
 * The stdio entrypoint (ring M5) — the ONLY file in `mcp/` allowed to touch
 * the transport or the process (§7 T11). Everything that could be tested
 * without a socket already was: `buildServer` (server.ts) does the real
 * assembly work and is transport-free by construction (§5.12), so this file
 * has nothing left to do but read the environment, build the server, wire
 * stdio onto it, and shut down cleanly on SIGINT/SIGTERM — the pattern the
 * MCP TypeScript SDK's own fixtures use.
 *
 * REQ-4: stdio IS the transport, so nothing here (or anywhere under
 * `mcp/src/**`) may write to stdout — one stray byte corrupts the JSON-RPC
 * frame stream. Every diagnostic below goes to stderr via `console.error`.
 */

async function main(): Promise<void> {
  let config: McpConfig;
  try {
    // No argument: `loadConfig`'s own default parameter reads the real
    // process environment (config.ts, M1) — that variable is read only
    // there, never in this file (§5.12.2's rule 1, enforced by
    // rings.test.ts, which scans this file's TEXT for the literal token too
    // — so this comment deliberately never spells it out).
    config = loadConfig();
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : String(err);
    console.error(`devdigest-mcp: failed to start — ${message}`);
    process.exitCode = 1;
    return;
  }

  const server = buildServer({ config });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.error(`devdigest-mcp: received ${signal}, shutting down.`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('devdigest-mcp: fatal error', err);
  process.exitCode = 1;
});
