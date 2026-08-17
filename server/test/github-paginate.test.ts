/**
 * OctokitGitHubClient.getPullRequest must page through `pulls/:n/files`.
 *
 * A single `per_page: 100` call silently truncates a large PR to its first 100
 * files while `changed_files` (from the PR object) still reports the true total —
 * so the UI renders "300 files" over 100 cards, AND those 100 rows overwrite the
 * cached diff. Hermetic: Octokit is handed a fake `fetch`, no network.
 */
import { describe, it, expect } from 'vitest';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';

const PR_BODY = {
  number: 1,
  title: 'Big refactor',
  user: { login: 'octocat' },
  head: { ref: 'feat/big', sha: 'abc123' },
  base: { ref: 'main' },
  additions: 900,
  deletions: 300,
  changed_files: 250,
  state: 'open',
  merged_at: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T01:00:00Z',
  body: null,
};

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const filePage = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    filename: `src/file-${from + i}.ts`,
    additions: 2,
    deletions: 1,
    patch: `@@ -1 +1,2 @@\n+// ${from + i}`,
  }));

/** Serves 250 files across three pages, linked the way the REST API links them. */
function makeFetch(pagesRequested: string[]) {
  const nextLink = (page: number) =>
    `<https://api.github.com/repos/acme/app/pulls/1/files?per_page=100&page=${page}>; rel="next"`;

  return async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

    if (href.includes('/pulls/1/files')) {
      const page = Number(new URL(href).searchParams.get('page') ?? '1');
      pagesRequested.push(`files:${page}`);
      if (page === 1) return json(filePage(1, 100), { link: nextLink(2) });
      if (page === 2) return json(filePage(101, 100), { link: nextLink(3) });
      return json(filePage(201, 50));
    }
    if (href.includes('/pulls/1/commits')) return json([]);
    if (href.includes('/pulls/1')) return json(PR_BODY);
    return json([]);
  };
}

describe('OctokitGitHubClient.getPullRequest', () => {
  it('pages through every changed file, not just the first 100', async () => {
    const pagesRequested: string[] = [];
    const gh = new OctokitGitHubClient('t0ken', {
      request: { fetch: makeFetch(pagesRequested) },
    });

    const detail = await gh.getPullRequest({ owner: 'acme', name: 'app' }, 1);

    expect(pagesRequested).toEqual(['files:1', 'files:2', 'files:3']);
    expect(detail.files).toHaveLength(250);
    expect(detail.files[0]!.path).toBe('src/file-1.ts');
    expect(detail.files[249]!.path).toBe('src/file-250.ts');
    // The count from the PR object and the rows fetched now agree — which is what
    // the route's degraded-payload check relies on.
    expect(detail.files_count).toBe(250);
  });
});
