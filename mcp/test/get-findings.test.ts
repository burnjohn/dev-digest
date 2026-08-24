import { describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ApiPort, ReviewProjection } from '../src/ports.js';
import { RepoCache } from '../src/resolve/cache.js';
import type { ResolverDeps } from '../src/resolve/resolver.js';
import { registerGetFindings, type GetFindingsDeps } from '../src/tools/get-findings.js';

/**
 * T10's own test file for the free, read-only twin of `run_agent_on_pr`
 * (§5.13.4, REQ-16). Every test supplies a fake `ApiPort` object literal
 * (REQ-32) whose `startReview` throws if it is ever called — the strongest
 * assertion that this tool starts nothing, matching `ports.ts`'s own
 * "throwing default" convention from `resolver.test.ts`.
 */

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
      throw new Error('REQ-16 violation: get_findings must never call startReview');
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

interface CapturedTool {
  name: string;
  config: { description?: string; annotations?: unknown };
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

function buildDeps(api: ApiPort): GetFindingsDeps {
  return { api, resolver: createResolverDeps(api) };
}

function reviewFixture(patch: Partial<ReviewProjection> = {}): ReviewProjection {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security',
    created_at: '2026-08-23T10:00:00.000Z',
    verdict: 'comment',
    score: 70,
    findings: [],
    ...patch,
  };
}

const finding = (patch: Partial<Record<string, unknown>> = {}) => ({
  id: 'f-1',
  severity: 'CRITICAL' as const,
  category: 'bug' as const,
  title: 'Off-by-one',
  file: 'src/x.ts',
  start_line: 10,
  end_line: 10,
  rationale: 'because',
  suggestion: null,
  confidence: 0.9,
  kind: null,
  trifecta_components: null,
  evidence: null,
  review_id: 'review-1',
  accepted_at: null,
  dismissed_at: null,
  ...patch,
});

describe('get_findings — registration (§5.13.4, D-G)', () => {
  it('registers with the frozen §5.13.4 description (736 bytes) and readOnlyHint:true', () => {
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(createFakeApi()));

    expect(registered).toHaveLength(1);
    const tool = registered[0]!;
    expect(tool.name).toBe('get_findings');
    expect(Buffer.byteLength(tool.config.description as string, 'utf8')).toBe(736);
    expect((tool.config.description as string).startsWith('Return the findings of a review')).toBe(true);
    expect(tool.config.annotations).toEqual({ readOnlyHint: true });
  });
});

describe('get_findings — REQ-16: never starts a review', () => {
  it('returns findings without ever calling startReview', async () => {
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listReviews: vi.fn(async () => [reviewFixture({ verdict: 'request_changes', score: 40, findings: [finding()] })]),
    });
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42 });

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ verdict: 'request_changes', shown: 1, total: 1 });
    expect(api.startReview).not.toHaveBeenCalled();
  });
});

describe('get_findings — narrowing with severity and file', () => {
  it('drops findings that do not match the requested severity', async () => {
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listReviews: vi.fn(async () => [
        reviewFixture({
          findings: [finding({ id: 'f-1', severity: 'CRITICAL' }), finding({ id: 'f-2', severity: 'SUGGESTION' })],
        }),
      ]),
    });
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42, severity: 'CRITICAL' });

    expect(result.structuredContent).toMatchObject({ shown: 1, total: 1 });
  });

  it('drops findings that do not match the requested file', async () => {
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listReviews: vi.fn(async () => [
        reviewFixture({
          findings: [finding({ id: 'f-1', file: 'src/a.ts' }), finding({ id: 'f-2', file: 'src/b.ts' })],
        }),
      ]),
    });
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42, file: 'src/b.ts' });

    expect(result.structuredContent).toMatchObject({ shown: 1, total: 1 });
  });
});

describe('get_findings — response_format', () => {
  it('detailed adds rationale/suggestion/confidence; concise (default) omits them', async () => {
    const api = createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listReviews: vi.fn(async () => [reviewFixture({ findings: [finding()] })]),
    });
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const concise = await registered[0]!.handler({ repo: 'owner/name', pr: 42 });
    const detailed = await registered[0]!.handler({ repo: 'owner/name', pr: 42, response_format: 'detailed' });

    type Grouped = { agents: { findings: Record<string, unknown>[] }[] };
    const conciseFinding = (concise.structuredContent as Grouped).agents[0]!.findings[0]!;
    const detailedFinding = (detailed.structuredContent as Grouped).agents[0]!.findings[0]!;

    expect(conciseFinding).not.toHaveProperty('rationale');
    expect(detailedFinding).toMatchObject({ rationale: 'because', confidence: 0.9 });
  });
});

describe('get_findings — resolution failure never becomes {findings: []}', () => {
  it('an unimported repo produces the catalogue message and an EMPTY structured result, not a zero-findings one', async () => {
    const api = createFakeApi({
      lookupPull: vi.fn(async () => ({
        ok: false as const,
        reason: 'repo_not_found' as const,
        message: 'nope',
        candidates: ['a/b'],
      })),
    });
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/missing', pr: 1 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('owner/missing');
    expect(result.structuredContent).toEqual({});
    expect(result.structuredContent).not.toHaveProperty('findings');
    expect(api.listReviews).not.toHaveBeenCalled();
  });
});

/**
 * The `agent` argument (REQ-1..REQ-3).
 *
 * These exist because the tool had no way to answer "show me the Performance
 * Reviewer's result": the only agent-specific path was `run_agent_on_pr`,
 * which bills a run. Every test here still runs against the `createFakeApi`
 * whose `startReview` throws, so each one doubles as a REQ-16 guard.
 */
describe('get_findings — narrowing to one agent', () => {
  const AGENTS = [
    { id: 'agent-api', name: 'API Contract Reviewer', model: 'x', enabled: true },
    { id: 'agent-perf', name: 'Performance Reviewer', model: 'x', enabled: true },
    { id: 'agent-off', name: 'Retired Reviewer', model: 'x', enabled: false },
  ];

  function twoReviews(): ReviewProjection[] {
    return [
      reviewFixture({
        run_id: 'run-perf',
        agent_id: 'agent-perf',
        agent_name: 'Performance Reviewer',
        created_at: '2026-08-23T19:13:21.000Z',
        verdict: 'approve',
        score: 100,
        findings: [],
      }),
      reviewFixture({
        run_id: 'run-api',
        agent_id: 'agent-api',
        agent_name: 'API Contract Reviewer',
        created_at: '2026-08-23T19:08:25.000Z',
        verdict: 'request_changes',
        score: 0,
        findings: [finding({ id: 'api-1', severity: 'CRITICAL' })],
      }),
    ];
  }

  function apiWith(reviews: ReviewProjection[]): ApiPort {
    return createFakeApi({
      lookupPull: vi.fn(async () => fakePull()),
      listAgents: vi.fn(async () => AGENTS),
      listReviews: vi.fn(async () => reviews),
    });
  }

  it('returns only the named agent group, matching the name case-insensitively', async () => {
    const api = apiWith(twoReviews());
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const result = await registered[0]!.handler({
      repo: 'owner/name',
      pr: 42,
      agent: 'performance reviewer',
    });

    const grouped = result.structuredContent as { agents: { agent_id: string; verdict: string }[] };
    expect(result.isError).toBe(false);
    expect(grouped.agents).toHaveLength(1);
    expect(grouped.agents[0]!.agent_id).toBe('agent-perf');
    expect(grouped.agents[0]!.verdict).toBe('approve');
    expect(api.startReview).not.toHaveBeenCalled();
  });

  it('accepts an agent id as well as a name', async () => {
    const api = apiWith(twoReviews());
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42, agent: 'agent-api' });

    const grouped = result.structuredContent as { agents: { agent_id: string }[] };
    expect(grouped.agents).toHaveLength(1);
    expect(grouped.agents[0]!.agent_id).toBe('agent-api');
  });

  it('reads a disabled agent stored review — disabled blocks new runs, not old results', async () => {
    const api = apiWith([
      reviewFixture({
        run_id: 'run-off',
        agent_id: 'agent-off',
        agent_name: 'Retired Reviewer',
        verdict: 'comment',
        findings: [finding({ id: 'off-1' })],
      }),
    ]);
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42, agent: 'Retired Reviewer' });

    const grouped = result.structuredContent as { agents: { reviewed: boolean; findings: unknown[] }[] };
    expect(result.isError).toBe(false);
    expect(grouped.agents[0]!.reviewed).toBe(true);
    expect(grouped.agents[0]!.findings).toHaveLength(1);
  });

  it('says an agent has not reviewed this PR instead of erroring or reporting zero findings', async () => {
    const api = apiWith(twoReviews());
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const result = await registered[0]!.handler({
      repo: 'owner/name',
      pr: 42,
      agent: 'Retired Reviewer',
    });

    const grouped = result.structuredContent as { agents: { reviewed: boolean }[] };
    expect(result.isError).toBe(false);
    expect(grouped.agents).toHaveLength(1);
    expect(grouped.agents[0]!.reviewed).toBe(false);
    expect(result.content[0]!.text).toContain('has not reviewed');
    expect(result.content[0]!.text).toContain('run_agent_on_pr');
    expect(api.startReview).not.toHaveBeenCalled();
  });

  it('errors on an unknown agent, and never reports it as an empty result', async () => {
    const api = apiWith(twoReviews());
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42, agent: 'nope' });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({});
    expect(result.content[0]!.text).toContain('list_agents');
    expect(api.listReviews).not.toHaveBeenCalled();
  });

  it('groups every agent when no agent is named, and names them in the summary', async () => {
    const api = apiWith(twoReviews());
    const { server, registered } = createFakeServer();
    registerGetFindings(server, buildDeps(api));

    const result = await registered[0]!.handler({ repo: 'owner/name', pr: 42 });

    const grouped = result.structuredContent as { agents: { agent_name: string }[] };
    expect(grouped.agents).toHaveLength(2);
    expect(result.content[0]!.text).toContain('API Contract Reviewer');
    expect(result.content[0]!.text).toContain('Performance Reviewer');
    expect(api.listAgents).not.toHaveBeenCalled();
  });
});
