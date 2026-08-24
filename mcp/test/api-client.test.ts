import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { ConfigError, loadConfig } from '../src/config.js';

const BASE = 'http://localhost:3001';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

function clientWith(fetchImpl: typeof fetch): ApiClient {
  return new ApiClient({ apiBaseUrl: BASE, fetchImpl });
}

describe('ApiClient — request shaping and URL construction (api/routes.ts)', () => {
  it('builds an encoded lookupPull URL and returns the parsed PullLookupResult', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ ok: true, pull: { repo_id: 'r1', pull_id: 'p1', number: 42 } });
    }) as unknown as typeof fetch;

    const client = clientWith(fetchImpl);
    const result = await client.lookupPull('owner name/repo#1', 42);

    expect(result).toEqual({ ok: true, pull: { repo_id: 'r1', pull_id: 'p1', number: 42 } });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/lookup/pull');
    // A round trip through URLSearchParams decodes back to the exact original —
    // the encoding assertion that actually matters (raw '/', ' ', '#' would
    // otherwise corrupt the query string or the path).
    expect(url.searchParams.get('repo')).toBe('owner name/repo#1');
    expect(url.searchParams.get('number')).toBe('42');
  });

  it('narrows /agents to {id, name, model, enabled} and drops everything else', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          id: 'a1',
          name: 'Security',
          model: 'gpt-5',
          enabled: true,
          system_prompt: 'do not leak this to the model',
          output_schema: { foo: 'bar' },
        },
      ]),
    ) as unknown as typeof fetch;

    const agents = await clientWith(fetchImpl).listAgents();
    expect(agents).toEqual([{ id: 'a1', name: 'Security', model: 'gpt-5', enabled: true }]);
    expect(agents[0]).not.toHaveProperty('system_prompt');
    expect(agents[0]).not.toHaveProperty('output_schema');
  });

  it('narrows /repos to {id, full_name} — the repo-only resolution source for get_conventions', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return jsonResponse([
        { id: 'r1', full_name: 'maxfurmanov/devdigest', workspace_id: 'w1', owner: 'maxfurmanov', name: 'devdigest' },
      ]);
    }) as unknown as typeof fetch;

    const repos = await clientWith(fetchImpl).listRepos();
    expect(repos).toEqual([{ id: 'r1', full_name: 'maxfurmanov/devdigest' }]);
    expect(repos[0]).not.toHaveProperty('workspace_id');
    expect(calls[0]).toContain('/repos');
  });

  it('lists active runs at /pulls/:id/runs/active — the in-flight source of truth', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return jsonResponse([{ run_id: 'run-1', agent_id: 'a1', agent_name: 'Security', ran_at: '2026-08-23T00:00:00Z' }]);
    }) as unknown as typeof fetch;

    const runs = await clientWith(fetchImpl).listActiveRuns('pull-123');
    expect(runs).toEqual([{ run_id: 'run-1', agent_id: 'a1', agent_name: 'Security', ran_at: '2026-08-23T00:00:00Z' }]);
    expect(calls[0]).toContain('/pulls/pull-123/runs/active');
  });

  it('starts a review with a JSON POST body and returns the new runId', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ pr_id: 'p1', runs: [{ run_id: 'run-9', agent_id: 'a1', agent_name: 'Security' }], reviews: [] });
    }) as unknown as typeof fetch;

    const { runId } = await clientWith(fetchImpl).startReview('pull-123', 'agent-1');
    expect(runId).toBe('run-9');
    expect(calls[0]!.url).toContain('/pulls/pull-123/review');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ agentId: 'agent-1' });
  });

  it('throws ApiError when POST /pulls/:id/review returns no runs', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ pr_id: 'p1', runs: [], reviews: [] })) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).startReview('pull-123', 'agent-1')).rejects.toBeInstanceOf(ApiError);
  });

  it('maps /pulls/:id/runs rows down to {run_id, agent_id, status, error}', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        { run_id: 'run-1', agent_id: 'a1', status: 'done', error: null, model: 'gpt-5', tokens_in: 100 },
      ]),
    ) as unknown as typeof fetch;

    const runs = await clientWith(fetchImpl).listRuns('pull-123');
    expect(runs).toEqual([{ run_id: 'run-1', agent_id: 'a1', status: 'done', error: null }]);
  });

  it('passes findings through listReviews', async () => {
    const finding = {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'x',
      file: 'a.ts',
      start_line: 1,
      end_line: 2,
      rationale: 'r',
      confidence: 0.9,
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ run_id: 'run-1', agent_id: 'a1', verdict: 'approve', score: 90, findings: [finding] }]),
    ) as unknown as typeof fetch;

    const reviews = await clientWith(fetchImpl).listReviews('pull-123');
    expect(reviews).toEqual([{ run_id: 'run-1', agent_id: 'a1', verdict: 'approve', score: 90, findings: [finding] }]);
  });

  it('unwraps /repos/:id/conventions to {rule, status} rows', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        candidates: [{ id: 'c1', rule: 'use kebab-case', status: 'accepted', confidence: 0.8, extra: 'dropped' }],
        last_scan: null,
      }),
    ) as unknown as typeof fetch;

    const conventions = await clientWith(fetchImpl).listConventions('repo-1');
    expect(conventions).toEqual([{ rule: 'use kebab-case', status: 'accepted' }]);
  });
});

describe('ApiClient — error translation (api/errors.ts)', () => {
  it('translates a connection-refused fetch failure into a next-step message', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    await expect(clientWith(fetchImpl).listAgents()).rejects.toMatchObject({
      name: 'ApiError',
      message: expect.stringContaining('cd server && pnpm dev'),
    });
  });

  it('translates an AbortError (per-request timeout) distinctly from connection-refused', async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;

    await expect(clientWith(fetchImpl).listAgents()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'timeout',
      message: expect.stringContaining('did not answer in time'),
    });
  });

  it('translates a non-2xx response body into the server-reported message', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 'not_found', message: 'Repo not imported' } }, { status: 404 }),
    ) as unknown as typeof fetch;

    await expect(clientWith(fetchImpl).listAgents()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'http_error',
      message: expect.stringContaining('Repo not imported'),
    });
  });

  it('translates an unparsable response body without throwing a second error', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;

    await expect(clientWith(fetchImpl).listAgents()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid_response',
    });
  });

  it('sends a per-request AbortSignal', async () => {
    let sawSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      sawSignal = init?.signal;
      return jsonResponse([]);
    }) as unknown as typeof fetch;

    await clientWith(fetchImpl).listAgents();
    expect(sawSignal).toBeInstanceOf(AbortSignal);
  });
});

describe('loadConfig — the only process.env reader in the package (config.ts, ring M1)', () => {
  it('defaults apiBaseUrl to the loopback API, budget to 90s, and allowRemote to false', () => {
    const cfg = loadConfig({});
    expect(cfg).toEqual({
      apiBaseUrl: 'http://localhost:3001',
      webUiUrl: 'http://localhost:3000',
      runBudgetMs: 90_000,
      allowRemote: false,
    });
  });

  it('coerces DEVDIGEST_MCP_RUN_BUDGET_MS from a string env var', () => {
    const cfg = loadConfig({ DEVDIGEST_MCP_RUN_BUDGET_MS: '45000' });
    expect(cfg.runBudgetMs).toBe(45_000);
  });

  it('rejects a non-loopback DEVDIGEST_API_URL unless DEVDIGEST_MCP_ALLOW_REMOTE=1 (§5.11)', () => {
    expect(() => loadConfig({ DEVDIGEST_API_URL: 'http://example.com:3001' })).toThrow(ConfigError);
  });

  it('accepts a non-loopback DEVDIGEST_API_URL when DEVDIGEST_MCP_ALLOW_REMOTE=1', () => {
    const cfg = loadConfig({ DEVDIGEST_API_URL: 'http://example.com:3001', DEVDIGEST_MCP_ALLOW_REMOTE: '1' });
    expect(cfg).toEqual({
      apiBaseUrl: 'http://example.com:3001',
      webUiUrl: 'http://localhost:3000',
      runBudgetMs: 90_000,
      allowRemote: true,
    });
  });

  it('accepts every loopback spelling without the opt-out', () => {
    for (const host of ['http://localhost:3001', 'http://127.0.0.1:3001']) {
      expect(() => loadConfig({ DEVDIGEST_API_URL: host })).not.toThrow();
    }
  });
});
