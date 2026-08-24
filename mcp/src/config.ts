import { z } from 'zod';

/**
 * Config (ring M1, the kernel) — the ONLY file in this package that may read
 * `process.env` (§5.12.2's cross-cutting rule 1; enforced for real by
 * `mcp/test/rings.test.ts`). Everything downstream — the adapter (M3), the
 * application ring (M2), the composition root (M5) — receives an already
 * parsed `McpConfig` through `Deps`, never a raw env var.
 *
 * No secret is read here. The API needs none today (`LocalNoAuthProvider`);
 * if that changes the credential comes from `~/.devdigest/secrets.json` with
 * `process.env` as fallback (server's own rule, §5.11) — never a value baked
 * into a tool argument the model can see or invent.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** True for `localhost`, `127.0.0.1`, `::1` — every other host is "remote". */
function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

const RawConfigSchema = z.object({
  DEVDIGEST_API_URL: z.string().url().default('http://localhost:3001'),
  /** The web UI's address (2026-08-23 remediation) — configuration exactly
   *  like `DEVDIGEST_API_URL`, so the literal default lives here (M1), where
   *  `rings.test.ts` allows it, and is threaded out to `resolve/messages.ts`
   *  as a parameter rather than hardcoded there. */
  DEVDIGEST_WEB_UI_URL: z.string().url().default('http://localhost:3000'),
  DEVDIGEST_MCP_RUN_BUDGET_MS: z.coerce.number().int().positive().default(90_000),
  DEVDIGEST_MCP_ALLOW_REMOTE: z.string().nullish(),
});

export interface McpConfig {
  /** Base URL of the DevDigest API. Loopback unless `allowRemote` is true. */
  apiBaseUrl: string;
  /** Base URL of the DevDigest web UI, for actionable error messages
   *  (`resolve/messages.ts`'s `repoNotImported`/`agentDisabled`). Same
   *  loopback rule as `apiBaseUrl` — it names a UI the agent's own
   *  operator runs locally, not an address to be pointed at anyone else's. */
  webUiUrl: string;
  /** REQ-13's wait budget for `run_agent_on_pr`, in milliseconds. */
  runBudgetMs: number;
  /** Whether a non-loopback `apiBaseUrl`/`webUiUrl` was explicitly opted into (§5.11). */
  allowRemote: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Parses `process.env` into `McpConfig`. Takes an explicit `env` parameter
 * (defaulting to the real `process.env`) so a test can supply a plain object
 * literal instead of mutating global state — the same `Deps`-style seam
 * §5.12.3 uses everywhere else in the package.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const parsed = RawConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid MCP environment configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  const allowRemote = parsed.data.DEVDIGEST_MCP_ALLOW_REMOTE === '1';
  const url = new URL(parsed.data.DEVDIGEST_API_URL);
  const webUiUrl = new URL(parsed.data.DEVDIGEST_WEB_UI_URL);

  if (!isLoopbackHost(url.hostname) && !allowRemote) {
    throw new ConfigError(
      `DEVDIGEST_API_URL (${parsed.data.DEVDIGEST_API_URL}) is not loopback. ` +
        'Set DEVDIGEST_MCP_ALLOW_REMOTE=1 to explicitly allow a non-local DevDigest API — ' +
        'a mis-set env var must not silently point this agent at someone else’s server.',
    );
  }

  if (!isLoopbackHost(webUiUrl.hostname) && !allowRemote) {
    throw new ConfigError(
      `DEVDIGEST_WEB_UI_URL (${parsed.data.DEVDIGEST_WEB_UI_URL}) is not loopback. ` +
        'Set DEVDIGEST_MCP_ALLOW_REMOTE=1 to explicitly allow a non-local DevDigest web UI — ' +
        'a mis-set env var must not silently point this agent at someone else’s server.',
    );
  }

  return {
    apiBaseUrl: parsed.data.DEVDIGEST_API_URL,
    webUiUrl: parsed.data.DEVDIGEST_WEB_UI_URL,
    runBudgetMs: parsed.data.DEVDIGEST_MCP_RUN_BUDGET_MS,
    allowRemote,
  };
}
