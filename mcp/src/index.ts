/**
 * Entry point for the DevDigest MCP server (stdio transport).
 *
 * IMPORTANT: stdout is reserved for MCP protocol framing (JSON-RPC 2.0 over stdio).
 * ALL diagnostic output MUST go to stderr (fd 2). No console.log, no process.stdout.write.
 *
 * Signal handling: SIGINT / SIGTERM → graceful close + exit 0.
 */

import pino from 'pino';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDevDigestMcpServer } from './server.js';
import { config } from './config.js';

// ---- Logger (stderr only) ---------------------------------------------------
// pino.destination(2) writes to fd 2 (stderr).
// pino-pretty is an optional dev dep — use it only if LOG_PRETTY env is set
// AND the module is available; otherwise fall back to JSON on stderr.

function buildLogger(): pino.Logger {
  const dest = pino.destination(2);

  if (config.logPretty) {
    try {
      // Dynamic import check — pino-pretty may not be installed in production.
      // We use the transport option so pino handles the worker thread itself.
      return pino(
        { level: 'info' },
        pino.transport({
          target: 'pino-pretty',
          options: { destination: 2, colorize: true, sync: true },
        }),
      );
    } catch {
      // pino-pretty not installed — fall through to plain JSON logger.
    }
  }

  return pino({ level: 'info' }, dest);
}

const logger = buildLogger();

// ---- Main -------------------------------------------------------------------

async function main(): Promise<void> {
  const server = createDevDigestMcpServer();

  // Graceful shutdown handlers.
  const shutdown = async (): Promise<void> => {
    logger.info('DevDigest MCP server shutting down');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  logger.info('DevDigest MCP server starting (stdio transport)');

  // connect() attaches the transport and begins listening on stdin.
  // This call will keep the process alive as long as the MCP client holds the connection.
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  logger.error({ err }, 'DevDigest MCP server fatal error');
  process.exit(1);
});
