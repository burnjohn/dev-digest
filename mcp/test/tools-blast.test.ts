import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiPort } from '../src/ports.js';
import type { BlastRadiusResponse } from '@devdigest/shared';
import { RepoCache } from '../src/resolve/cache.js';
import type { ResolverDeps } from '../src/resolve/resolver.js';
import { registerTool, type ToolRegistration } from '../src/tools/_register.js';
import { registerGetBlastRadius, type GetBlastRadiusDeps } from '../src/tools/get-blast-radius.js';
import { MAX_BLAST_CHIPS, MAX_BLAST_SYMBOLS } from '../src/shaping/constants.js';

/**
 * `registerTool`'s own structural-gate tests (unchanged since T8 — REQ-5,
 * REQ-6, REQ-7, REQ-9) live in this file, plus `get_blast_radius`'s tests
 * (T3, docs/plans/06-blast-radius.md): the tool is WIRED now — it resolves a
 * pull, calls `ApiPort.getBlastRadius`, and returns a projected result
 * (REQ-17). No `implemented: false` stub branch survives.
 */

interface CapturedTool {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    annotations?: unknown;
  };
  handler: (args: unknown) => Promise<{
    content: { type: string; text: string }[];
    structuredContent: unknown;
    isError: boolean;
  }>;
}

function createFakeServer(): { server: McpServer; registered: CapturedTool[] } {
  const registered: CapturedTool[] = [];
  const fake = {
    registerTool: vi.fn((name: string, config: CapturedTool['config'], handler: CapturedTool['handler']) => {
      registered.push({ name, config, handler });
    }),
  };
  return { server: fake as unknown as McpServer, registered };
}

const VALID_CONFIG: ToolRegistration<{ repo: z.ZodString }, { ok: z.ZodBoolean }> = {
  title: 'Flat',
  description: 'short',
  inputSchema: { repo: z.string() },
  outputSchema: { ok: z.boolean() },
  annotations: { readOnlyHint: true },
};

async function noopHandler() {
  return { structuredContent: { ok: true }, text: 'ok' };
}

describe('registerTool — the structural gate every tool registers through (REQ-5, REQ-6, REQ-7, REQ-9)', () => {
  it('registers a valid flat tool, passing all five config keys through to server.registerTool', () => {
    const { server, registered } = createFakeServer();

    registerTool(server, 'flat_tool', VALID_CONFIG, noopHandler);

    expect(registered).toHaveLength(1);
    const tool = registered[0]!;
    expect(tool.name).toBe('flat_tool');
    expect(tool.config.title).toBe('Flat');
    expect(tool.config.description).toBe('short');
    expect(tool.config.inputSchema).toBeDefined();
    expect(tool.config.outputSchema).toBeDefined();
    expect(tool.config.annotations).toEqual({ readOnlyHint: true });
  });

  it('rejects a name outside the SEP-986 charset (REQ-5)', () => {
    const { server } = createFakeServer();
    expect(() => registerTool(server, 'bad name!', VALID_CONFIG, noopHandler)).toThrow(/SEP-986/);
  });

  it('throws at registration when description exceeds the 2048-byte UTF-8 budget, never truncates (REQ-7)', () => {
    const { server, registered } = createFakeServer();
    const overLong = 'x'.repeat(2049);

    expect(() =>
      registerTool(server, 'oversized_tool', { ...VALID_CONFIG, description: overLong }, noopHandler),
    ).toThrow(/2048/);
    // The throw happens before server.registerTool is ever called — nothing
    // truncated slips through.
    expect(registered).toHaveLength(0);
  });

  it('rejects an object-typed input property (REQ-9)', () => {
    const { server } = createFakeServer();
    expect(() =>
      registerTool(
        server,
        'nested_object_tool',
        { ...VALID_CONFIG, inputSchema: { filters: z.object({ severity: z.string() }) } },
        noopHandler,
      ),
    ).toThrow(/object- or array-typed/);
  });

  it('rejects an array-typed input property (REQ-9)', () => {
    const { server } = createFakeServer();
    expect(() =>
      registerTool(
        server,
        'nested_array_tool',
        { ...VALID_CONFIG, inputSchema: { tags: z.array(z.string()) } },
        noopHandler,
      ),
    ).toThrow(/object- or array-typed/);
  });

  it('accepts an optional flat primitive — optionality alone is not nesting', () => {
    const { server, registered } = createFakeServer();
    registerTool(server, 'optional_flat_tool', { ...VALID_CONFIG, inputSchema: { repo: z.string().optional() } }, noopHandler);
    expect(registered).toHaveLength(1);
  });
});

describe('registerTool — type-level: all five config keys are structurally required (REQ-6)', () => {
  it('is proven by `npm run typecheck` failing without these @ts-expect-error lines', () => {
    // @ts-expect-error — omitting `outputSchema` must be a compile error.
    const missingOutputSchema: ToolRegistration<{ repo: z.ZodString }, { ok: z.ZodBoolean }> = {
      title: 'Missing',
      description: 'short',
      inputSchema: { repo: z.string() },
      annotations: { readOnlyHint: true },
    };
    void missingOutputSchema;

    // @ts-expect-error — omitting `annotations` must be a compile error.
    const missingAnnotations: ToolRegistration<{ repo: z.ZodString }, { ok: z.ZodBoolean }> = {
      title: 'Missing',
      description: 'short',
      inputSchema: { repo: z.string() },
      outputSchema: { ok: z.boolean() },
    };
    void missingAnnotations;

    const missingReadOnlyHint: ToolRegistration<{ repo: z.ZodString }, { ok: z.ZodBoolean }> = {
      title: 'Missing',
      description: 'short',
      inputSchema: { repo: z.string() },
      outputSchema: { ok: z.boolean() },
      // @ts-expect-error — omitting `readOnlyHint` must be a compile error:
      // it is required, never defaulted (the anti-"defaulting readOnlyHint"
      // red flag).
      annotations: {},
    };
    void missingReadOnlyHint;

    expect(true).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* get_blast_radius — wired (REQ-17, REQ-18, T3)                            */
/* ------------------------------------------------------------------------ */

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
      throw new Error('REQ-17 violation: get_blast_radius must never call startReview');
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
    getBlastRadius: vi.fn(async () => {
      throw new Error('getBlastRadius not stubbed for this test');
    }),
    ...overrides,
  };
}

function createResolverDeps(api: ApiPort): ResolverDeps {
  return { api, cache: new RepoCache({ ttlMs: 5 * 60_000 }), now: () => 0 };
}

function buildDeps(api: ApiPort): GetBlastRadiusDeps {
  return { api, resolver: createResolverDeps(api) };
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

function chip(label: string, kind: 'endpoint' | 'cron', file = 'src/routes.ts') {
  return { label, kind, file };
}

function symbol(
  name: string,
  overrides: Partial<BlastRadiusResponse['symbols'][number]> = {},
): BlastRadiusResponse['symbols'][number] {
  return {
    name,
    file: 'src/x.ts',
    kind: 'function',
    callers: [],
    caller_count: 0,
    chips: [],
    ...overrides,
  };
}

function blastFixture(patch: Partial<BlastRadiusResponse> = {}): BlastRadiusResponse {
  return {
    status: 'ok',
    status_reason: '',
    coverage: {
      callers_available: true,
      endpoints_available: true,
      crons_available: true,
      imports_available: true,
      prior_prs_available: true,
      files_indexed: 10,
      files_skipped: 0,
      index_truncated: false,
    },
    changed_file_count: 1,
    totals: { symbols: 1, callers: 0, endpoints: 0, crons: 0 },
    symbols: [symbol('doThing')],
    file_impact: [],
    prior_prs: [],
    narrative: null,
    ...patch,
  };
}

describe('get_blast_radius — registration (REQ-17, REQ-18)', () => {
  it('registers with readOnlyHint:true, a description starting with the tool\'s own promise, and no implemented:false literal', () => {
    const { server, registered } = createFakeServer();
    registerGetBlastRadius(server, buildDeps(createFakeApi()));

    expect(registered).toHaveLength(1);
    const tool = registered[0]!;
    expect(tool.name).toBe('get_blast_radius');
    expect(tool.config.annotations).toEqual({ readOnlyHint: true });

    const description = tool.config.description as string;
    expect(description).toContain('heuristic map');
    expect(description).not.toContain('implemented');
  });
});

describe('get_blast_radius — REQ-17: resolves the pull before calling getBlastRadius', () => {
  it('resolves repo+pr through resolvePull, then calls ApiPort.getBlastRadius with the resolved pullId', async () => {
    const getBlastRadius = vi.fn(async () => blastFixture());
    const api = createFakeApi({ lookupPull: vi.fn(async () => fakePull()), getBlastRadius });
    const { server, registered } = createFakeServer();
    registerGetBlastRadius(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42 });

    expect(result.isError).toBe(false);
    expect(getBlastRadius).toHaveBeenCalledWith('pull-1');
  });

  it('returns isError:true with the resolver message on an unresolvable repo, and never calls getBlastRadius', async () => {
    const getBlastRadius = vi.fn(async () => blastFixture());
    const api = createFakeApi({
      lookupPull: vi.fn(async () => ({
        ok: false as const,
        reason: 'repo_not_found' as const,
        message: 'nope',
        candidates: [],
      })),
      getBlastRadius,
    });
    const { server, registered } = createFakeServer();
    registerGetBlastRadius(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/missing', pr: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('owner/missing');
    expect(result.structuredContent).toEqual({});
    expect(getBlastRadius).not.toHaveBeenCalled();
  });
});

describe('get_blast_radius — projection (REQ-18)', () => {
  it('carries status/status_reason/totals through, and shapes symbols to {symbol, file, caller_count}', async () => {
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      getBlastRadius: vi.fn(async () =>
        blastFixture({
          status: 'degraded',
          status_reason: 'the index is unavailable, so cron impact could not be determined',
          totals: { symbols: 1, callers: 3, endpoints: 1, crons: 0 },
          symbols: [symbol('doThing', { caller_count: 3, chips: [chip('GET /repos/:id', 'endpoint')] })],
        }),
      ),
    });
    const { server, registered } = createFakeServer();
    registerGetBlastRadius(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42 });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      status: 'degraded',
      status_reason: 'the index is unavailable, so cron impact could not be determined',
      totals: { symbols: 1, callers: 3, endpoints: 1, crons: 0 },
      symbols: [{ symbol: 'doThing', file: 'src/x.ts', caller_count: 3 }],
      chips: [{ label: 'GET /repos/:id', kind: 'endpoint' }],
      truncated: false,
    });
    expect(result.content[0]!.text).toContain('degraded');
    // Never the per-caller file:line rows, rank, file_impact, prior_prs or narrative.
    expect(result.structuredContent).not.toHaveProperty('file_impact');
    expect(result.structuredContent).not.toHaveProperty('prior_prs');
    expect(result.structuredContent).not.toHaveProperty('narrative');
    expect(result.structuredContent).not.toHaveProperty('coverage');
  });

  it('caps symbols and chips at their named constants, keeping the server-provided order, and reports truncated:true', async () => {
    const manySymbols = Array.from({ length: MAX_BLAST_SYMBOLS + 5 }, (_, i) =>
      symbol(`sym${i}`, { caller_count: i }),
    );
    const manyChips = Array.from({ length: MAX_BLAST_CHIPS + 5 }, (_, i) => chip(`GET /path/${i}`, 'endpoint'));
    // Already first in the server's own order — not sorted here first, which
    // is the point: the projection trusts this position rather than deriving it.
    manySymbols[0] = symbol('winner', { caller_count: 999, chips: manyChips });

    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      getBlastRadius: vi.fn(async () => blastFixture({ symbols: manySymbols })),
    });
    const { server, registered } = createFakeServer();
    registerGetBlastRadius(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42 });

    const structured = result.structuredContent as {
      symbols: { symbol: string; caller_count: number }[];
      chips: unknown[];
      truncated: boolean;
    };
    expect(structured.symbols).toHaveLength(MAX_BLAST_SYMBOLS);
    expect(structured.symbols.map((s) => s.symbol)).toEqual(
      manySymbols.slice(0, MAX_BLAST_SYMBOLS).map((s) => s.name),
    );
    expect(structured.symbols[0]!.symbol).toBe('winner');
    expect(structured.chips).toHaveLength(MAX_BLAST_CHIPS);
    expect(structured.truncated).toBe(true);
  });
});
