import { describe, it, expect, vi } from 'vitest';
import { makeOk, makeErr, getResultText } from '../setup.js';
import type { BlastResponse } from '@devdigest/shared';

vi.mock('../../src/api-client.js', () => ({
  fetchAgents: vi.fn(),
  fetchRepoPulls: vi.fn(),
  postReview: vi.fn(),
  fetchRuns: vi.fn(),
  fetchReviews: vi.fn(),
  fetchConventions: vi.fn(),
  fetchBrief: vi.fn(),
  fetchBlast: vi.fn(),
  enrichMessage: vi.fn((code: string, message: string) => message),
}));

import { getBlastRadiusTool } from '../../src/tools/get-blast-radius.js';
import * as apiClient from '../../src/api-client.js';

const fetchBlastMock = vi.mocked(apiClient.fetchBlast);

const PR_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

/** Minimal BlastResponse with data available */
function makeBlastResponse(overrides: Partial<BlastResponse> = {}): BlastResponse {
  return {
    available: true,
    blast: {
      summary: '2 symbols changed · 3 callers · 1 endpoint',
      changed_symbols: [
        { name: 'getCache', file: 'src/cache.ts', kind: 'function' },
        { name: 'setCache', file: 'src/cache.ts', kind: 'function' },
      ],
      downstream: [
        {
          symbol: 'useCache',
          callers: [
            { name: 'ComponentA', file: 'src/a.ts', line: 10 },
            { name: 'ComponentB', file: 'src/b.ts', line: 20 },
            { name: 'ComponentC', file: 'src/c.ts', line: 5 },
          ],
          endpoints_affected: ['/api/data'],
          crons_affected: [],
        },
      ],
    },
    history: {
      history: [
        {
          pr_number: 42,
          title: 'Add caching layer',
          merged_at: '2026-06-01T12:00:00Z',
          author: 'alice',
          files_overlap: ['src/cache.ts'],
          notes: '',
        },
      ],
    },
    index: {
      status: 'full',
      degraded: false,
      reason: null,
    },
    link: {
      owner: 'acme',
      repo: 'my-app',
      head_sha: 'abc123def456',
    },
    ...overrides,
  };
}

/** BlastResponse with available:false */
function makeBlastUnavailable(): BlastResponse {
  return {
    available: false,
    blast: null,
    history: { history: [] },
    index: {
      status: 'degraded',
      degraded: true,
      reason: 'ripgrep fallback returned no results',
    },
    link: null,
  };
}

describe('get_blast_radius tool', () => {
  describe('handler', () => {
    it('returns available:true with projected counts and callers for a live PR', async () => {
      fetchBlastMock.mockResolvedValue(makeOk(makeBlastResponse()));

      const result = await getBlastRadiusTool.handler({ pr_id: PR_ID });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getResultText(result));

      expect(parsed.available).toBe(true);
      expect(parsed.symbols_count).toBe(2);
      expect(parsed.callers_count).toBe(3);
      expect(parsed.endpoints_count).toBe(1);
      expect(parsed.crons_count).toBe(0);
      expect(parsed.summary).toBe('2 symbols changed · 3 callers · 1 endpoint');

      // per-symbol callers projected as file:line + name
      expect(Array.isArray(parsed.symbols)).toBe(true);
      expect(parsed.symbols).toHaveLength(1);
      const sym = parsed.symbols[0];
      expect(sym.symbol).toBe('useCache');
      expect(sym.callers).toHaveLength(3);
      expect(sym.callers[0].ref).toBe('src/a.ts:10');
      expect(sym.callers[0].name).toBe('ComponentA');

      // prior PRs
      expect(parsed.prior_prs).toHaveLength(1);
      expect(parsed.prior_prs[0].pr_number).toBe(42);
      expect(parsed.prior_prs[0].title).toBe('Add caching layer');

      // index state passed through
      expect(parsed.index.status).toBe('full');
      expect(parsed.index.degraded).toBe(false);
    });

    it('returns available:false passthrough with reason and index state when index is unavailable', async () => {
      fetchBlastMock.mockResolvedValue(makeOk(makeBlastUnavailable()));

      const result = await getBlastRadiusTool.handler({ pr_id: PR_ID });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getResultText(result));

      expect(parsed.available).toBe(false);
      expect(typeof parsed.reason).toBe('string');
      expect(parsed.reason.length).toBeGreaterThan(0);
      expect(parsed.index).toBeDefined();
      expect(parsed.index.degraded).toBe(true);
    });

    it('returns isError:true when fetchBlast returns an api error', async () => {
      fetchBlastMock.mockResolvedValue(
        makeErr('network_error', 'DevDigest API is unreachable at http://localhost:3001; ensure the server is running'),
      );

      const result = await getBlastRadiusTool.handler({ pr_id: PR_ID });

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain('unreachable');
    });

    it('returns isError:true when fetchBlast returns a not_found error', async () => {
      fetchBlastMock.mockResolvedValue(
        makeErr('not_found', 'PR not found'),
      );

      const result = await getBlastRadiusTool.handler({ pr_id: PR_ID });

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain('not found');
    });
  });
});
