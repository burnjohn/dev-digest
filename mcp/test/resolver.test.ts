import { describe, expect, it, vi } from 'vitest';
import type { ApiPort, AgentSummary, RepoSummary } from '../src/ports.js';
import { RepoCache } from '../src/resolve/cache.js';
import {
  listAcceptedConventions,
  resolveAgent,
  resolveAgentForRead,
  resolvePull,
  resolveRepoId,
  type ResolverDeps,
} from '../src/resolve/resolver.js';
import { sampleCatalogue, TOOL_NAMES } from '../src/resolve/messages.js';

/**
 * REQ-32's mock seam: a full `ApiPort` object literal, never a cast. Every
 * method has a throwing default so a test that forgets to stub the one it
 * needs fails loudly instead of silently resolving `undefined`.
 */
function createFakeApi(overrides: Partial<ApiPort> = {}): ApiPort {
  return {
    lookupPull: vi.fn(async () => {
      throw new Error('lookupPull not stubbed for this test');
    }),
    listAgents: vi.fn(async () => []),
    listRepos: vi.fn(async () => []),
    listActiveRuns: vi.fn(async () => []),
    startReview: vi.fn(async () => {
      throw new Error('startReview not stubbed for this test');
    }),
    listRuns: vi.fn(async () => []),
    listReviews: vi.fn(async () => []),
    listConventions: vi.fn(async () => []),
    getBlastRadius: vi.fn(async () => {
      throw new Error('getBlastRadius not stubbed for this test');
    }),
    ...overrides,
  };
}

function createDeps(overrides: Partial<ResolverDeps> = {}): ResolverDeps {
  return {
    api: createFakeApi(),
    cache: new RepoCache({ ttlMs: 5 * 60_000 }),
    now: () => 0,
    ...overrides,
  };
}

function fakePull(repo: string, number: number, patch: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true as const,
    pull: {
      repo_id: 'repo-1',
      pull_id: 'pull-1',
      number,
      full_name: repo,
      head_sha: 'abc123',
      title: 'Add a feature',
      status: 'open' as const,
      ...patch,
    },
  };
}

describe('resolvePull', () => {
  it('resolves repo+pr through exactly one lookupPull call and returns the narrowed pull', async () => {
    const lookupPull = vi.fn(async (repo: string, number: number) => fakePull(repo, number));
    const api = createFakeApi({ lookupPull });

    const result = await resolvePull('owner/name', 42, createDeps({ api }));

    expect(result).toEqual({
      ok: true,
      pull: {
        repoId: 'repo-1',
        pullId: 'pull-1',
        number: 42,
        fullName: 'owner/name',
        headSha: 'abc123',
        title: 'Add a feature',
        status: 'open',
      },
    });
    expect(lookupPull).toHaveBeenCalledTimes(1);
    expect(lookupPull).toHaveBeenCalledWith('owner/name', 42);
  });

  it('rejects a malformed repo before any port call is made', async () => {
    const lookupPull = vi.fn(async () => {
      throw new Error('must not be called for a malformed repo');
    });
    const api = createFakeApi({ lookupPull });

    const result = await resolvePull('not-a-slug', 1, createDeps({ api }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('run_agent_on_pr');
    expect(lookupPull).not.toHaveBeenCalled();
  });

  it('caps repo length so an adversarial string never reaches the port', async () => {
    const lookupPull = vi.fn(async () => {
      throw new Error('must not be called for an over-length repo');
    });
    const api = createFakeApi({ lookupPull });
    const huge = `${'a'.repeat(250)}/b`;

    const result = await resolvePull(huge, 1, createDeps({ api }));

    expect(result.ok).toBe(false);
    expect(lookupPull).not.toHaveBeenCalled();
  });

  it('turns a repo_not_found result into the actionable catalogue message, never {findings: []}', async () => {
    const lookupPull = vi.fn(async () => ({
      ok: false as const,
      reason: 'repo_not_found' as const,
      message: 'nope',
      candidates: ['a/b', 'c/d'],
    }));
    const api = createFakeApi({ lookupPull });

    const result = await resolvePull('owner/missing', 1, createDeps({ api }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('owner/missing');
      expect(result.message).toContain('a/b');
      expect(result.message).toContain('run_agent_on_pr');
    }
  });

  it('turns a pull_not_found result into the actionable catalogue message', async () => {
    const lookupPull = vi.fn(async () => ({
      ok: false as const,
      reason: 'pull_not_found' as const,
      message: 'nope',
      candidates: ['45', '46'],
    }));
    const api = createFakeApi({ lookupPull });

    const result = await resolvePull('owner/name', 999, createDeps({ api }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('#999');
      expect(result.message).toContain('45');
    }
  });

  it('never returns an empty-success shape on failure — resolution failures are always {ok:false, message}', async () => {
    const lookupPull = vi.fn(async () => ({
      ok: false as const,
      reason: 'repo_not_found' as const,
      message: 'nope',
      candidates: [],
    }));
    const api = createFakeApi({ lookupPull });

    const result = await resolvePull('owner/name', 1, createDeps({ api }));

    expect(result).not.toHaveProperty('findings');
    expect(result.ok).toBe(false);
  });
});

describe('REQ-26 — the owner/name → repo_id cache', () => {
  it('a resolved repo_id is readable back from the cache within its TTL, with no second lookupPull', async () => {
    const lookupPull = vi.fn(async (repo: string, number: number) => fakePull(repo, number));
    const api = createFakeApi({ lookupPull });
    const cache = new RepoCache({ ttlMs: 5 * 60_000 });
    const now = () => 1_000;

    await resolvePull('owner/name', 1, { api, cache, now });

    expect(cache.get('owner/name', 1_000)).toBe('repo-1');
    expect(cache.get('owner/name', 4_000)).toBe('repo-1');
    expect(lookupPull).toHaveBeenCalledTimes(1);
  });

  it('a cache miss — including one past its TTL — is never served; a miss is re-requested every time', () => {
    const cache = new RepoCache({ ttlMs: 100 });
    cache.set('owner/name', 'repo-1', 0);

    expect(cache.get('owner/name', 50)).toBe('repo-1');
    expect(cache.get('owner/name', 150)).toBeUndefined();
    expect(cache.get('owner/never-set', 0)).toBeUndefined();
  });

  it('never caches a negative result', async () => {
    const lookupPull = vi.fn(async () => ({
      ok: false as const,
      reason: 'repo_not_found' as const,
      message: 'nope',
      candidates: [],
    }));
    const api = createFakeApi({ lookupPull });
    const cache = new RepoCache({ ttlMs: 5 * 60_000 });

    await resolvePull('owner/name', 1, { api, cache, now: () => 0 });

    expect(cache.get('owner/name', 0)).toBeUndefined();
  });

  it('never serves a PR-level lookup from cache — resolving the same (repo, number) twice calls lookupPull twice', async () => {
    const lookupPull = vi.fn(async (repo: string, number: number) => fakePull(repo, number));
    const api = createFakeApi({ lookupPull });
    const deps = createDeps({ api });

    await resolvePull('owner/name', 7, deps);
    await resolvePull('owner/name', 7, deps);

    expect(lookupPull).toHaveBeenCalledTimes(2);
  });
});

describe('resolveAgent', () => {
  const agents: AgentSummary[] = [
    { id: 'agent-1', name: 'Security', model: 'gpt-5', enabled: true },
    { id: 'agent-2', name: 'Style', model: 'gpt-5', enabled: false },
  ];

  it('matches by exact id first', async () => {
    const api = createFakeApi({ listAgents: vi.fn(async () => agents) });

    const result = await resolveAgent('agent-1', createDeps({ api }));

    expect(result).toEqual({ ok: true, agent: { agentId: 'agent-1', name: 'Security' } });
  });

  it('falls back to a case-insensitive name match', async () => {
    const api = createFakeApi({ listAgents: vi.fn(async () => agents) });

    const result = await resolveAgent('security', createDeps({ api }));

    expect(result).toEqual({ ok: true, agent: { agentId: 'agent-1', name: 'Security' } });
  });

  it('produces the owner\'s "call list_agents" message for an unknown agent', async () => {
    const api = createFakeApi({ listAgents: vi.fn(async () => agents) });

    const result = await resolveAgent('nonexistent', createDeps({ api }));

    expect(result).toEqual({
      ok: false,
      message: 'Agent `nonexistent` not found — call `list_agents` for valid ids.',
    });
  });

  it('reports a disabled match rather than silently substituting another agent', async () => {
    const api = createFakeApi({ listAgents: vi.fn(async () => agents) });

    const result = await resolveAgent('agent-2', createDeps({ api }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('is disabled');
      expect(result.message).toContain('list_agents');
    }
  });
});

describe('REQ-22 — the error catalogue, checked in bulk', () => {
  it('every message names one of the five tools or a backticked command/URL', () => {
    const commandLikeRe = /`[^`]*(pnpm|npm|http:\/\/|cd )[^`]*`/;

    for (const message of sampleCatalogue()) {
      const namesTool = TOOL_NAMES.some((name) => message.includes(name));
      expect(namesTool || commandLikeRe.test(message), message).toBe(true);
    }
  });
});

describe('2026-08-23 remediation — webUiUrl threaded through ResolverDeps', () => {
  it('resolvePull restores the actionable address on a repo_not_found result when webUiUrl is supplied', async () => {
    const lookupPull = vi.fn(async () => ({
      ok: false as const,
      reason: 'repo_not_found' as const,
      message: 'nope',
      candidates: [],
    }));
    const api = createFakeApi({ lookupPull });

    const result = await resolvePull('owner/missing', 1, createDeps({ api, webUiUrl: 'http://localhost:3000' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('http://localhost:3000');
  });

  it('resolvePull falls back to naming the web UI when webUiUrl is not supplied', async () => {
    const lookupPull = vi.fn(async () => ({
      ok: false as const,
      reason: 'repo_not_found' as const,
      message: 'nope',
      candidates: [],
    }));
    const api = createFakeApi({ lookupPull });

    const result = await resolvePull('owner/missing', 1, createDeps({ api }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain('http://');
      expect(result.message).toContain("DevDigest's web UI");
    }
  });

  it('resolveAgent restores the actionable /agents address for a disabled agent when webUiUrl is supplied', async () => {
    const agents: AgentSummary[] = [{ id: 'agent-2', name: 'Style', model: 'gpt-5', enabled: false }];
    const api = createFakeApi({ listAgents: vi.fn(async () => agents) });

    const result = await resolveAgent('agent-2', createDeps({ api, webUiUrl: 'http://localhost:3000' }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('http://localhost:3000/agents');
  });
});

describe('resolveRepoId (2026-08-23 remediation — moved from tools/get-conventions.ts into M2)', () => {
  const repos: RepoSummary[] = [{ id: 'repo-1', full_name: 'maxfurmanov/devdigest' }];

  it('resolves a known repo full_name to its id via listRepos', async () => {
    const listRepos = vi.fn(async () => repos);
    const api = createFakeApi({ listRepos });

    const result = await resolveRepoId('maxfurmanov/devdigest', createDeps({ api }));

    expect(result).toEqual({ ok: true, repoId: 'repo-1' });
    expect(listRepos).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed repo slug before any listRepos call', async () => {
    const listRepos = vi.fn(async () => {
      throw new Error('must not be called for a malformed repo');
    });
    const api = createFakeApi({ listRepos });

    const result = await resolveRepoId('not-a-slug', createDeps({ api }));

    expect(result.ok).toBe(false);
    expect(listRepos).not.toHaveBeenCalled();
  });

  it('produces the repoNotImported catalogue message for an unmatched repo, never a silent empty result', async () => {
    const api = createFakeApi({ listRepos: vi.fn(async () => repos) });

    const result = await resolveRepoId('someone-else/other-repo', createDeps({ api }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('is not imported into DevDigest');
      expect(result.message).toContain('maxfurmanov/devdigest');
    }
  });

  it('reads a cached repo_id back on a second call, without a second listRepos (REQ-26, coherent read/write policy)', async () => {
    const listRepos = vi.fn(async () => repos);
    const api = createFakeApi({ listRepos });
    const cache = new RepoCache({ ttlMs: 5 * 60_000 });
    const deps: ResolverDeps = { api, cache, now: () => 0 };

    await resolveRepoId('maxfurmanov/devdigest', deps);
    const second = await resolveRepoId('maxfurmanov/devdigest', deps);

    expect(second).toEqual({ ok: true, repoId: 'repo-1' });
    expect(listRepos).toHaveBeenCalledTimes(1);
  });

  it('never caches a negative resolution', async () => {
    const api = createFakeApi({ listRepos: vi.fn(async () => []) });
    const cache = new RepoCache({ ttlMs: 5 * 60_000 });
    const deps: ResolverDeps = { api, cache, now: () => 0 };

    await resolveRepoId('owner/missing', deps);

    expect(cache.get('owner/missing', 0)).toBeUndefined();
  });
});

describe('listAcceptedConventions (2026-08-23 remediation — the accepted-only filter, moved into M2)', () => {
  it('keeps only accepted conventions, dropping pending and rejected', async () => {
    const listConventions = vi.fn(async () => [
      { rule: 'use kebab-case', status: 'accepted' as const },
      { rule: 'no default exports', status: 'pending' as const },
      { rule: 'no console.log', status: 'rejected' as const },
    ]);
    const api = createFakeApi({ listConventions });

    const result = await listAcceptedConventions('repo-1', createDeps({ api }));

    expect(result).toEqual([{ rule: 'use kebab-case', status: 'accepted' }]);
    expect(listConventions).toHaveBeenCalledWith('repo-1');
  });

  it('returns an empty array, not an error, when the repo has no accepted conventions', async () => {
    const api = createFakeApi({ listConventions: vi.fn(async () => []) });

    const result = await listAcceptedConventions('repo-1', createDeps({ api }));

    expect(result).toEqual([]);
  });
});

/**
 * The read-only counterpart. The pair is asserted side by side on purpose:
 * the ONLY difference between them is the `enabled` gate, and a test that
 * exercised just one of the two would not document that.
 */
describe('resolveAgentForRead', () => {
  const agents: AgentSummary[] = [
    { id: 'agent-1', name: 'Security', model: 'gpt-5', enabled: true },
    { id: 'agent-2', name: 'Style', model: 'gpt-5', enabled: false },
  ];

  it('matches by id and by name, case-insensitively, exactly like resolveAgent', async () => {
    const api = createFakeApi({ listAgents: vi.fn(async () => agents) });

    const byId = await resolveAgentForRead('agent-1', createDeps({ api }));
    const byName = await resolveAgentForRead('SECURITY', createDeps({ api }));

    expect(byId.ok && byId.agent.agentId).toBe('agent-1');
    expect(byName.ok && byName.agent.agentId).toBe('agent-1');
  });

  it('resolves a DISABLED agent that resolveAgent refuses — its stored findings are still readable', async () => {
    const api = createFakeApi({ listAgents: vi.fn(async () => agents) });

    const forRun = await resolveAgent('agent-2', createDeps({ api }));
    const forRead = await resolveAgentForRead('agent-2', createDeps({ api }));

    expect(forRun.ok).toBe(false);
    expect(forRead.ok).toBe(true);
    expect(forRead.ok && forRead.agent.name).toBe('Style');
  });

  it('still refuses an agent that does not exist at all', async () => {
    const api = createFakeApi({ listAgents: vi.fn(async () => agents) });

    const result = await resolveAgentForRead('nonexistent', createDeps({ api }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('list_agents');
  });
});
