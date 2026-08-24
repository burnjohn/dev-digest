import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpConfig } from './config.js';
import type { ApiPort } from './ports.js';
import { ApiClient } from './api/client.js';
import { RepoCache } from './resolve/cache.js';
import type { ResolverDeps } from './resolve/resolver.js';
import { buildInstructions } from './instructions.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';

/**
 * The composition root (ring M5, REQ-32) — the one place in `mcp/` allowed
 * to name everything: every ring's `Deps`, the concrete `ApiClient`, and all
 * five tool registrations. Transport-free by construction — nothing here
 * imports `server/stdio.js` or touches `process.stdin`/`process.stdout` —
 * which is what makes T12's token-cost measurement possible without a
 * socket (§5.10) and what `index.ts` (the only file that DOES own the
 * transport) builds on.
 *
 * Direct analogue of `server/src/platform/container.ts` one layer down: a
 * `ContainerOverrides`-shaped `ServerDeps` lets a test or `T12`'s script
 * supply a fake `ApiPort`/clock without needing a `Container`, a real HTTP
 * call, or a cast (`server/INSIGHTS.md`, 2026-08-15 — REQ-32's own citation).
 */

/** Name/version sent in the `initialize` handshake — bump alongside
 *  `mcp/package.json`'s own `version` field; not read from it at runtime so
 *  `buildServer` stays a synchronous, filesystem-free function. */
const SERVER_NAME = 'devdigest';
const SERVER_VERSION = '0.0.0';

/** `resolve/resolver.ts`'s cache TTL (REQ-26) — repos are added rarely and
 *  ids never change once assigned, so five minutes trades a vanishingly rare
 *  staleness window for skipping a repeat lookup. */
const REPO_CACHE_TTL_MS = 5 * 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Everything `buildServer` needs, with every field a production caller
 * (`index.ts`) leaves at its default and only a test or `T12`'s measurement
 * script overrides — the exact shape `run-agent-on-pr.test.ts` already
 * established for `RunAgentOnPrDeps` (flat, no nested `resolver` object a
 * caller could half-populate).
 */
export interface ServerDeps {
  /** Already-parsed, already-validated configuration (`config.ts`, M1) —
   *  `buildServer` never reads the process environment itself (§5.12.2's
   *  rule 1; `rings.test.ts` scans this file's text for that literal too). */
  config: McpConfig;
  /** Overrides the ONE `ApiClient` this function would otherwise construct.
   *  Real production callers never set this — it exists so a test or T12's
   *  script can supply a fake `ApiPort` with no network, no transport
   *  (REQ-4). When absent, `new ApiClient({apiBaseUrl: config.apiBaseUrl})`
   *  below is the package's one and only construction site (REQ-32). */
  api?: ApiPort;
  /** Overrides `run_agent_on_pr`'s wait-loop sleep (`run/waiter.ts`, REQ-13)
   *  — real callers never set this; a fake-timer test does. */
  sleep?: (ms: number) => Promise<void>;
  /** Overrides the wait-loop clock — same reasoning as `sleep`. */
  now?: () => number;
}

/**
 * Assembles a fully-registered `McpServer`: constructs the concrete
 * `ApiClient` from `deps.config` (unless a test overrides it), builds each
 * ring's `Deps`, sets the frozen `instructions` (§5.13.1, D-G), and
 * registers all five tools (D-D) — nothing else. Touches no transport;
 * `index.ts` is the only file that connects one.
 */
export function buildServer(deps: ServerDeps): McpServer {
  const api: ApiPort = deps.api ?? new ApiClient({ apiBaseUrl: deps.config.apiBaseUrl });
  const cache = new RepoCache({ ttlMs: REPO_CACHE_TTL_MS });
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: buildInstructions(deps.config.apiBaseUrl) },
  );

  const resolverDeps: ResolverDeps = { api, cache, now, webUiUrl: deps.config.webUiUrl };

  registerListAgents(server, { api });
  registerGetConventions(server, resolverDeps);
  registerGetFindings(server, { api, resolver: resolverDeps });
  registerRunAgentOnPr(server, {
    api,
    cache,
    budgetMs: deps.config.runBudgetMs,
    sleep,
    now,
    webUiUrl: deps.config.webUiUrl,
  });
  registerGetBlastRadius(server);

  return server;
}
