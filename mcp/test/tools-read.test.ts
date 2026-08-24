import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiPort } from '../src/ports.js';
import { RepoCache } from '../src/resolve/cache.js';
import { registerListAgents } from '../src/tools/list-agents.js';
import { registerGetConventions } from '../src/tools/get-conventions.js';
import { ListAgentsOutput } from '../src/schemas/agents.js';
import { GetConventionsOutput } from '../src/schemas/conventions.js';

/**
 * T9's own tests — `list_agents` and `get_conventions` (REQ-11, REQ-20). A
 * fake `McpServer` captures exactly what `registerTool` passed through, the
 * same pattern `test/tools-blast.test.ts` (T8) established. `ApiPort` is
 * always a plain object literal (`server/INSIGHTS.md`, 2026-08-15's mock
 * seam) — never a `fetch` stub, and `RepoCache` is the real class T6
 * shipped, not a fake, because it is pure application code with no I/O.
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

function fakeApi(overrides: Partial<ApiPort> = {}): ApiPort {
  return {
    lookupPull: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    listRepos: vi.fn().mockResolvedValue([]),
    listActiveRuns: vi.fn(),
    startReview: vi.fn(),
    listRuns: vi.fn(),
    listReviews: vi.fn(),
    listConventions: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('list_agents (REQ-11)', () => {
  it('registers with the frozen §5.13.2 description and readOnlyHint:true', () => {
    const { server, registered } = createFakeServer();
    registerListAgents(server, { api: fakeApi() });

    expect(registered).toHaveLength(1);
    const tool = registered[0]!;
    expect(tool.name).toBe('list_agents');
    expect(tool.config.annotations).toEqual({ readOnlyHint: true });

    const description = tool.config.description as string;
    expect(Buffer.byteLength(description, 'utf8')).toBe(298);
    expect(description).toBe(
      'List the reviewer agents configured in DevDigest, each with its id, name, model and enabled flag. ' +
        'Call this first to obtain a valid `agent` value for `run_agent_on_pr` — agent ids are uuids and ' +
        "cannot be guessed. Returns one short line per agent; never the agent's system prompt or output schema.",
    );
  });

  it('returns exactly {agents:[{id,name,model,enabled}]} — never system_prompt or output_schema', async () => {
    const { server, registered } = createFakeServer();
    const api = fakeApi({
      listAgents: vi.fn().mockResolvedValue([{ id: 'a1', name: 'Security', model: 'gpt-5', enabled: true }]),
    });
    registerListAgents(server, { api });

    const tool = registered[0]!;
    const result = await tool.handler({});

    expect(result.isError).toBe(false);
    const structured = z.object(ListAgentsOutput).parse(result.structuredContent);
    expect(structured).toEqual({ agents: [{ id: 'a1', name: 'Security', model: 'gpt-5', enabled: true }] });
    expect(JSON.stringify(result.structuredContent)).not.toContain('system_prompt');
    expect(JSON.stringify(result.structuredContent)).not.toContain('output_schema');
  });
});

describe('get_conventions(repo) (REQ-20)', () => {
  it('registers as a Tool taking repo as a flat string, with the frozen §5.13.5 description', () => {
    const { server, registered } = createFakeServer();
    registerGetConventions(server, { api: fakeApi(), cache: new RepoCache({ ttlMs: 60_000 }), now: () => 0 });

    expect(registered).toHaveLength(1);
    const tool = registered[0]!;
    expect(tool.name).toBe('get_conventions');
    expect(tool.config.annotations).toEqual({ readOnlyHint: true });

    const inputShape = tool.config.inputSchema as Record<string, z.ZodTypeAny>;
    expect(inputShape.repo).toBeInstanceOf(z.ZodString);

    const description = tool.config.description as string;
    expect(Buffer.byteLength(description, 'utf8')).toBe(352);
    expect(description).toBe(
      'Return the coding conventions DevDigest extracted from a repository — the house rules its code ' +
        'actually follows. `repo` is "owner/name". Read them before writing or reviewing code in that ' +
        'repository, so the change matches existing style instead of guessing at it. Returns one line per ' +
        'convention with its status; it reviews nothing and starts no run.',
    );
  });

  it('resolves repo → repo_id via listRepos, and returns only accepted rules as a bare projection', async () => {
    const { server, registered } = createFakeServer();
    const listConventions = vi.fn().mockResolvedValue([
      { rule: 'use kebab-case', status: 'accepted' },
      { rule: 'no default exports', status: 'pending' },
    ]);
    const api = fakeApi({
      listRepos: vi.fn().mockResolvedValue([{ id: 'repo-1', full_name: 'maxfurmanov/devdigest' }]),
      listConventions,
    });
    registerGetConventions(server, { api, cache: new RepoCache({ ttlMs: 60_000 }), now: () => 0 });

    const tool = registered[0]!;
    const result = await tool.handler({ repo: 'maxfurmanov/devdigest' });

    expect(result.isError).toBe(false);
    const structured = z.object(GetConventionsOutput).parse(result.structuredContent);
    expect(structured).toEqual({ conventions: [{ rule: 'use kebab-case', status: 'accepted' }] });
    expect(listConventions).toHaveBeenCalledWith('repo-1');
    // Never the wire ConventionListResult shape — no scan-stats block.
    expect(result.structuredContent).not.toHaveProperty('last_scan');
    expect(result.structuredContent).not.toHaveProperty('candidates');
  });

  it('caches a successful repo resolution (REQ-26) — a second call skips listRepos', async () => {
    const { server, registered } = createFakeServer();
    const listRepos = vi.fn().mockResolvedValue([{ id: 'repo-1', full_name: 'maxfurmanov/devdigest' }]);
    const api = fakeApi({ listRepos, listConventions: vi.fn().mockResolvedValue([]) });
    const cache = new RepoCache({ ttlMs: 60_000 });
    registerGetConventions(server, { api, cache, now: () => 0 });

    const tool = registered[0]!;
    await tool.handler({ repo: 'maxfurmanov/devdigest' });
    await tool.handler({ repo: 'maxfurmanov/devdigest' });

    expect(listRepos).toHaveBeenCalledTimes(1);
  });

  it('an unresolvable repo produces the T6 catalogue "repo not imported" message, not an empty list', async () => {
    const { server, registered } = createFakeServer();
    const api = fakeApi({
      listRepos: vi.fn().mockResolvedValue([{ id: 'repo-1', full_name: 'someone-else/other-repo' }]),
    });
    registerGetConventions(server, { api, cache: new RepoCache({ ttlMs: 60_000 }), now: () => 0 });

    const tool = registered[0]!;
    const result = await tool.handler({ repo: 'maxfurmanov/devdigest' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('is not imported into DevDigest');
    expect(result.content[0]?.text).toContain('someone-else/other-repo');
    // Never a silent-success empty list — 2026-08-17's fail-open insight.
    expect(result.structuredContent).toEqual({ conventions: [] });
  });

  it('a malformed repo slug produces the malformedRepo message before any listRepos call', async () => {
    const { server, registered } = createFakeServer();
    const listRepos = vi.fn().mockResolvedValue([]);
    registerGetConventions(server, { api: fakeApi({ listRepos }), cache: new RepoCache({ ttlMs: 60_000 }), now: () => 0 });

    const tool = registered[0]!;
    const result = await tool.handler({ repo: 'not-a-slug' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('`repo` must be `owner/name`');
    expect(listRepos).not.toHaveBeenCalled();
  });

  it('2026-08-23 remediation: restores the actionable web UI address when ResolverDeps.webUiUrl is supplied', async () => {
    const { server, registered } = createFakeServer();
    const api = fakeApi({
      listRepos: vi.fn().mockResolvedValue([{ id: 'repo-1', full_name: 'someone-else/other-repo' }]),
    });
    registerGetConventions(server, {
      api,
      cache: new RepoCache({ ttlMs: 60_000 }),
      now: () => 0,
      webUiUrl: 'http://localhost:3000',
    });

    const tool = registered[0]!;
    const result = await tool.handler({ repo: 'maxfurmanov/devdigest' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('http://localhost:3000');
  });

  it('the handler stays thin: it never filters conventions itself — resolveRepoId/listAcceptedConventions (M2) already returned only accepted rows', async () => {
    const { server, registered } = createFakeServer();
    const listConventions = vi.fn().mockResolvedValue([{ rule: 'only this shipped', status: 'accepted' }]);
    const api = fakeApi({
      listRepos: vi.fn().mockResolvedValue([{ id: 'repo-1', full_name: 'maxfurmanov/devdigest' }]),
      listConventions,
    });
    registerGetConventions(server, { api, cache: new RepoCache({ ttlMs: 60_000 }), now: () => 0 });

    const tool = registered[0]!;
    const result = await tool.handler({ repo: 'maxfurmanov/devdigest' });

    const structured = z.object(GetConventionsOutput).parse(result.structuredContent);
    expect(structured).toEqual({ conventions: [{ rule: 'only this shipped', status: 'accepted' }] });
  });
});
