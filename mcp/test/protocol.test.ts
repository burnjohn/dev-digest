import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ApiPort, RunStatus } from '../src/ports.js';
import type { McpConfig } from '../src/config.js';
import { buildServer, type ServerDeps } from '../src/server.js';
import { buildInstructions } from '../src/instructions.js';
import { fromFetchFailure } from '../src/api/errors.js';
import { sampleCatalogue, TOOL_NAMES } from '../src/resolve/messages.js';

/**
 * T11's own tests — the composition root (`server.ts`, `index.ts`) and the
 * frozen `instructions` string (§5.13.1, D-G). Two things this file does
 * that no sibling test file does:
 *
 *   - it drives every tool through a REAL `McpServer`, built by the actual
 *     `buildServer(deps)` T11 ships, connected over the SDK's own
 *     `InMemoryTransport` to a real `Client` — no socket, no network, but a
 *     genuine protocol round trip (`tools/list`, `tools/call`) rather than a
 *     captured `registerTool` callback. That is the only way to observe the
 *     SDK's own exception-to-`isError` translation (see the "API down" case
 *     below), and it is what makes the wiring tests below prove something a
 *     unit test of `resolve/resolver.ts` cannot: that `config.webUiUrl` and
 *     `config.runBudgetMs` actually REACH the registered handlers through
 *     `buildServer`'s own wiring, not just that the resolver knows what to
 *     do with them once handed them directly.
 *   - the wait-loop tests use an INJECTED virtual clock (`instantClock`
 *     below) — `now`/`sleep` overrides on `ServerDeps` — rather than
 *     `vi.useFakeTimers()`. `run/waiter.ts`'s own loop only ever calls
 *     `deps.now()`/`deps.sleep()`, so a `sleep` that resolves instantly
 *     while incrementing a counter reproduces REQ-13's deadline discipline
 *     with zero real or fake wall-clock time — no timer to advance, nothing
 *     to hang if a test is wrong.
 */

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      out.push(...listTsFiles(abs));
    } else if (entry.endsWith('.ts')) {
      out.push(abs);
    }
  }
  return out;
}

function createFakeApi(overrides: Partial<ApiPort> = {}): ApiPort {
  return {
    lookupPull: vi.fn(async () => {
      throw new Error('lookupPull not stubbed for this test');
    }),
    listAgents: vi.fn(async () => {
      throw new Error('listAgents not stubbed for this test');
    }),
    listRepos: vi.fn(async () => {
      throw new Error('listRepos not stubbed for this test');
    }),
    listActiveRuns: vi.fn(async () => {
      throw new Error('listActiveRuns not stubbed for this test');
    }),
    startReview: vi.fn(async () => {
      throw new Error('startReview not stubbed for this test');
    }),
    listRuns: vi.fn(async () => {
      throw new Error('listRuns not stubbed for this test');
    }),
    listReviews: vi.fn(async () => {
      throw new Error('listReviews not stubbed for this test');
    }),
    listConventions: vi.fn(async () => {
      throw new Error('listConventions not stubbed for this test');
    }),
    ...overrides,
  };
}

function fakePull(patch: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    pull: {
      repo_id: 'repo-1',
      pull_id: 'pull-1',
      number: 42,
      full_name: 'owner/name',
      head_sha: 'abc123',
      title: 'Add a feature',
      status: 'open' as const,
      ...patch,
    },
  };
}

function baseConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  return {
    apiBaseUrl: 'http://localhost:3001',
    webUiUrl: 'http://localhost:3000',
    runBudgetMs: 90_000,
    allowRemote: false,
    ...overrides,
  };
}

/** A purely virtual clock: `sleep` never waits, it just advances a counter.
 *  `run/waiter.ts`'s loop only ever reads `now()`/awaits `sleep()`, so this
 *  reproduces the whole deadline-discipline arithmetic with no timer at all —
 *  the "injected sleep/timeout path, not a real timer" the task calls for. */
function instantClock(): { now: () => number; sleep: (ms: number) => Promise<void>; elapsed: () => number } {
  let elapsed = 0;
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms;
    },
    elapsed: () => elapsed,
  };
}

/** Builds a real `McpServer` via `buildServer(deps)` and connects it to a
 *  real `Client` over the SDK's own `InMemoryTransport` — in-process message
 *  passing, no socket, no network (`InMemoryTransport`'s own implementation
 *  is a direct function call plus a `Promise`, never a `setTimeout`). */
async function connectServer(deps: ServerDeps): Promise<{ client: Client; server: McpServer }> {
  const server = buildServer(deps);
  const client = new Client({ name: 'protocol-test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function firstText(result: unknown): string {
  const content = (result as { content?: unknown }).content as { type: string; text: string }[] | undefined;
  return content?.[0]?.text ?? '';
}

/* ------------------------------------------------------------------------ */
/* Static checks — no server construction needed                            */
/* ------------------------------------------------------------------------ */

describe('REQ-8 — no alwaysLoad anywhere under mcp/src/**', () => {
  it('grep finds neither "alwaysLoad" nor "anthropic/alwaysLoad"', () => {
    for (const abs of listTsFiles(SRC_ROOT)) {
      const content = readFileSync(abs, 'utf8');
      expect(content.includes('alwaysLoad'), `${path.relative(SRC_ROOT, abs)} contains "alwaysLoad" (REQ-8)`).toBe(
        false,
      );
    }
  });
});

/** Strips `/* ... *\/` and `// ...` comments before the REQ-32 grep below —
 *  `api/client.ts`'s own doc comment spells out `new ApiClient(...)` as the
 *  anti-pattern it warns against ("a module-level singleton wearing a
 *  container's clothes"), which is a real, deliberate false positive for a
 *  naive scan. Code, not prose, is what REQ-32 constrains. */
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('REQ-32 — new ApiClient(...) is constructed exactly once in the package, in server.ts', () => {
  it('a package-wide grep over CODE (not doc comments) finds exactly one call site', () => {
    const hits: string[] = [];
    for (const abs of listTsFiles(SRC_ROOT)) {
      const code = stripComments(readFileSync(abs, 'utf8'));
      const matches = code.match(/new\s+ApiClient\(/g);
      if (matches) {
        for (const _m of matches) hits.push(path.relative(SRC_ROOT, abs).split(path.sep).join('/'));
      }
    }
    expect(hits).toEqual(['server.ts']);
  });
});

describe("P0's placeholder index.ts is gone", () => {
  it('index.ts wires the real stdio transport rather than the export {} placeholder', () => {
    const content = readFileSync(path.join(SRC_ROOT, 'index.ts'), 'utf8');
    expect(content).toContain('StdioServerTransport');
    expect(content).toContain('buildServer');
    expect(content.trim()).not.toBe('export {};');
  });
});

/* ------------------------------------------------------------------------ */
/* instructions.ts (§5.13.1, D-G)                                           */
/* ------------------------------------------------------------------------ */

describe('buildInstructions (§5.13.1, D-G)', () => {
  it('renders §5.13.1 byte for byte with the default apiBaseUrl, measuring exactly 557 UTF-8 bytes', () => {
    const rendered = buildInstructions('http://localhost:3001');

    expect(rendered).toBe(
      [
        "DevDigest runs AI code review on GitHub pull requests locally. Search this server when the " +
          'user asks to review a pull request, wants the findings of a review that already ran, asks ' +
          "which reviewer agents are configured, or asks about a repository's coding conventions.",
        'Typical arc: `list_agents` for a valid agent id, then `run_agent_on_pr` to review, then ' +
          '`get_findings` to re-read the result later.',
        'Every tool takes `repo` as "owner/name" and `pr` as the pull request number. Requires the ' +
          'DevDigest API at http://localhost:3001 (`cd server && pnpm dev`).',
      ].join('\n\n'),
    );
    expect(Buffer.byteLength(rendered, 'utf8')).toBe(557);
  });

  it('is parameterized on apiBaseUrl — a non-default value is reflected verbatim, never hardcoded', () => {
    const rendered = buildInstructions('http://example.test:9999');
    expect(rendered).toContain('http://example.test:9999');
    expect(rendered).not.toContain('localhost:3001');
  });
});

/* ------------------------------------------------------------------------ */
/* buildServer(deps) — transport-free (REQ-4, REQ-32)                       */
/* ------------------------------------------------------------------------ */

describe('buildServer(deps) — REQ-4, REQ-32: runs with a fake ApiPort, no transport, no socket, no network', () => {
  it('returns a fully configured McpServer from a plain object-literal ServerDeps', () => {
    const server = buildServer({ config: baseConfig(), api: createFakeApi() });
    expect(server).toBeInstanceOf(McpServer);
  });
});

/* ------------------------------------------------------------------------ */
/* The whole tool surface, driven through a real connected client           */
/* ------------------------------------------------------------------------ */

describe('the whole tool surface (REQ-5, REQ-7, REQ-9), driven through buildServer(deps) + a real Client', () => {
  it('registers exactly the five D-D tools, each SEP-986 valid, with the six frozen byte counts', async () => {
    const { client, server } = await connectServer({ config: baseConfig(), api: createFakeApi() });
    try {
      const { tools } = await client.listTools();

      expect(tools.map((t) => t.name).sort()).toEqual(
        ['get_blast_radius', 'get_conventions', 'get_findings', 'list_agents', 'run_agent_on_pr'].sort(),
      );

      const nameRe = /^[A-Za-z0-9_.\-/]{1,64}$/;
      for (const tool of tools) {
        expect(nameRe.test(tool.name), `"${tool.name}" is not a valid SEP-986 tool name`).toBe(true);
      }

      const byteCountByName = Object.fromEntries(
        tools.map((t) => [t.name, Buffer.byteLength(t.description ?? '', 'utf8')]),
      );
      // The six frozen byte counts from §5.13's table — reported here in full
      // so a mismatch shows every count, not just the one that drifted.
      expect(byteCountByName).toEqual({
        list_agents: 298,
        run_agent_on_pr: 780,
        get_findings: 736,
        get_conventions: 352,
        get_blast_radius: 285,
      });

      expect(client.getInstructions()).toBe(buildInstructions('http://localhost:3001'));
      expect(Buffer.byteLength(client.getInstructions() ?? '', 'utf8')).toBe(557);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('REQ-9 — no registered input schema has an object- or array-typed property', async () => {
    const { client, server } = await connectServer({ config: baseConfig(), api: createFakeApi() });
    try {
      const { tools } = await client.listTools();
      for (const tool of tools) {
        const properties = tool.inputSchema.properties ?? {};
        for (const [key, propSchema] of Object.entries(properties)) {
          const type = (propSchema as { type?: string }).type;
          expect(type === 'object' || type === 'array', `${tool.name}.${key} is ${String(type)}-typed`).toBe(false);
        }
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});

/* ------------------------------------------------------------------------ */
/* The wiring test that actually matters (2026-08-23 remediation)           */
/* ------------------------------------------------------------------------ */

describe('the wiring test that actually matters — config reaches every ring through buildServer, proven with sentinels', () => {
  const SENTINEL_WEB_UI = 'http://example.test';

  it('run_agent_on_pr, get_findings, AND get_conventions each surface the sentinel webUiUrl on an unresolvable repo', async () => {
    const api = createFakeApi({
      lookupPull: vi.fn(async () => ({
        ok: false as const,
        reason: 'repo_not_found' as const,
        message: 'nope',
        candidates: [],
      })),
      listRepos: vi.fn(async () => []),
    });
    const { client, server } = await connectServer({ config: baseConfig({ webUiUrl: SENTINEL_WEB_UI }), api });
    try {
      const runResult = await client.callTool({
        name: 'run_agent_on_pr',
        arguments: { repo: 'owner/missing', pr: 1, agent: 'x' },
      });
      const findingsResult = await client.callTool({
        name: 'get_findings',
        arguments: { repo: 'owner/missing', pr: 1 },
      });
      const conventionsResult = await client.callTool({
        name: 'get_conventions',
        arguments: { repo: 'owner/missing' },
      });

      for (const [name, result] of [
        ['run_agent_on_pr', runResult],
        ['get_findings', findingsResult],
        ['get_conventions', conventionsResult],
      ] as const) {
        expect(result.isError, `${name} did not report isError:true`).toBe(true);
        expect(firstText(result), `${name}'s text did not carry the sentinel webUiUrl`).toContain(SENTINEL_WEB_UI);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('a sentinel runBudgetMs reaches run_agent_on_pr through the injected sleep/timeout path — no real timer', async () => {
    const clock = instantClock();
    const SENTINEL_BUDGET_MS = 4_321;
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listAgents: vi.fn(async () => [{ id: 'agent-1', name: 'Security', model: 'gpt-5', enabled: true }]),
      listActiveRuns: vi.fn(async () => []),
      startReview: vi.fn(async () => ({ runId: 'run-1' })),
      // Never resolves — with a real budget this would hang; with the
      // instant clock below the poll's own `sleep(remainingMs)` always wins
      // the race, so the timeout branch fires deterministically.
      listRuns: vi.fn(() => new Promise<RunStatus[]>(() => {})),
    });
    const { client, server } = await connectServer({
      config: baseConfig({ runBudgetMs: SENTINEL_BUDGET_MS }),
      api,
      sleep: clock.sleep,
      now: clock.now,
    });
    try {
      const result = await client.callTool({
        name: 'run_agent_on_pr',
        arguments: { repo: 'owner/name', pr: 42, agent: 'agent-1' },
      });

      expect(result.isError).toBe(false);
      expect(result.structuredContent).toEqual({ run_id: 'run-1', status: 'running', poll_with: 'get_findings' });
      // The wait loop's own virtual clock landed EXACTLY on the sentinel
      // budget (not the 90_000ms default) — proof config.runBudgetMs, not
      // some hardcoded value, reached run/waiter.ts through this wiring.
      expect(clock.elapsed()).toBe(SENTINEL_BUDGET_MS);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

/* ------------------------------------------------------------------------ */
/* The API-down bring-up failure (2026-08-23 remediation) — pinned for T12  */
/* ------------------------------------------------------------------------ */

describe('the API-down case — nobody had observed this before (2026-08-23 remediation)', () => {
  it('a lookupPull rejection propagates through the SDK as isError:true with the fromFetchFailure text, verbatim', async () => {
    const apiBaseUrl = 'http://localhost:3001';
    const api = createFakeApi({
      lookupPull: vi.fn(async () => {
        throw fromFetchFailure(new TypeError('fetch failed'), apiBaseUrl);
      }),
    });
    const { client, server } = await connectServer({ config: baseConfig({ apiBaseUrl }), api });
    try {
      const result = await client.callTool({ name: 'get_findings', arguments: { repo: 'owner/name', pr: 1 } });

      expect(result.isError).toBe(true);
      expect(firstText(result)).toBe(fromFetchFailure(new TypeError('fetch failed'), apiBaseUrl).message);
      expect(firstText(result)).toBe(
        'DevDigest API is not answering at `http://localhost:3001`. Start it with `cd server && pnpm dev`, then retry.',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});

/* ------------------------------------------------------------------------ */
/* REQ-22 — whole-catalogue reconfirmation at the composition root          */
/* ------------------------------------------------------------------------ */

describe('REQ-22 — every catalogue message names a tool or a backticked command (re-checked at the composition root)', () => {
  it('every resolve/messages.ts entry contains one of the five tool names, or a backticked command/URL', () => {
    const commandLikeRe = /`[^`]*(pnpm|npm|http:\/\/|cd )[^`]*`/;

    for (const message of sampleCatalogue()) {
      const namesTool = TOOL_NAMES.some((name) => message.includes(name));
      expect(namesTool || commandLikeRe.test(message), message).toBe(true);
    }
  });
});
