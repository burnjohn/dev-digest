import { describe, it, expect, vi } from 'vitest';
import { makeConvention, makeOk, makeErr, getResultText } from '../setup.js';

vi.mock('../../src/api-client.js', () => ({
  fetchAgents: vi.fn(),
  fetchRepoPulls: vi.fn(),
  postReview: vi.fn(),
  fetchRuns: vi.fn(),
  fetchReviews: vi.fn(),
  fetchConventions: vi.fn(),
  fetchBrief: vi.fn(),
  enrichMessage: vi.fn((code: string, message: string) => message),
}));

import { getConventionsTool } from '../../src/tools/get-conventions.js';
import * as apiClient from '../../src/api-client.js';

const fetchConventionsMock = vi.mocked(apiClient.fetchConventions);

const REPO_ID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';

describe('get_conventions tool', () => {
  describe('handler', () => {
    it('returns only accepted and verified conventions, dropping pending/rejected/edited', async () => {
      const conventions = [
        makeConvention('accepted', { id: 'c1', rule: 'Rule accepted' }),
        makeConvention('verified', { id: 'c2', rule: 'Rule verified' }),
        makeConvention('pending', { id: 'c3', rule: 'Rule pending' }),
        makeConvention('rejected_user', { id: 'c4', rule: 'Rule rejected_user' }),
        makeConvention('rejected_evidence', { id: 'c5', rule: 'Rule rejected_evidence' }),
        makeConvention('edited', { id: 'c6', rule: 'Rule edited' }),
      ];
      fetchConventionsMock.mockResolvedValue(makeOk(conventions));

      const result = await getConventionsTool.handler({ repo_id: REPO_ID });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getResultText(result));

      // Only 2 pass the filter
      expect(parsed).toHaveLength(2);
      const statuses: string[] = parsed.map((c: { status: string }) => c.status);
      expect(statuses).toContain('accepted');
      expect(statuses).toContain('verified');
      expect(statuses).not.toContain('pending');
      expect(statuses).not.toContain('rejected_user');
      expect(statuses).not.toContain('rejected_evidence');
      expect(statuses).not.toContain('edited');
    });

    it('returns empty array when no conventions pass the filter', async () => {
      const conventions = [
        makeConvention('pending'),
        makeConvention('rejected_user'),
      ];
      fetchConventionsMock.mockResolvedValue(makeOk(conventions));

      const result = await getConventionsTool.handler({ repo_id: REPO_ID });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getResultText(result));
      expect(parsed).toEqual([]);
    });

    it('returns isError:true when fetchConventions fails with repo not found', async () => {
      fetchConventionsMock.mockResolvedValue(
        makeErr('not_found', 'Repo not found; verify the repo_id is correct'),
      );

      const result = await getConventionsTool.handler({ repo_id: REPO_ID });

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain('repo_id');
    });
  });
});
