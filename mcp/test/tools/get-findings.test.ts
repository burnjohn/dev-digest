import { describe, it, expect, vi } from 'vitest';
import { makeReviewRecord, makeFinding, makeOk, makeErr, getResultText } from '../setup.js';

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

import { getFindingsTool } from '../../src/tools/get-findings.js';
import * as apiClient from '../../src/api-client.js';

const fetchReviewsMock = vi.mocked(apiClient.fetchReviews);

const PR_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

describe('get_findings tool', () => {
  describe('handler', () => {
    it('concise mode omits finding bodies and includes findings_breakdown', async () => {
      const findings = [
        makeFinding('CRITICAL', '1'),
        makeFinding('WARNING', '2'),
      ];
      const review = makeReviewRecord({ findings });
      fetchReviewsMock.mockResolvedValue(makeOk([review]));

      const result = await getFindingsTool.handler({
        pr_id: PR_ID,
        response_format: 'concise',
        limit: 20,
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getResultText(result));

      // Should be an array of ConciseReviewEntry objects
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).not.toHaveProperty('findings');
      expect(parsed[0]).toHaveProperty('findings_breakdown');
      expect(parsed[0].findings_breakdown).toEqual({ critical: 1, warning: 1, suggestion: 0 });
    });

    it('detailed mode includes top_findings and has_more when total exceeds limit', async () => {
      // 25 findings, limit 20 → has_more:true
      const findings = Array.from({ length: 25 }, (_, i) =>
        makeFinding('WARNING', String(i + 1)),
      );
      const review = makeReviewRecord({ findings });
      fetchReviewsMock.mockResolvedValue(makeOk([review]));

      const result = await getFindingsTool.handler({
        pr_id: PR_ID,
        response_format: 'detailed',
        limit: 20,
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getResultText(result));

      expect(parsed).toHaveProperty('agents');
      expect(parsed).toHaveProperty('has_more', true);
      expect(parsed).toHaveProperty('total_findings', 25);
      expect(parsed.agents[0]).toHaveProperty('top_findings');
    });

    it('returns empty array for concise mode when no reviews exist', async () => {
      fetchReviewsMock.mockResolvedValue(makeOk([]));

      const result = await getFindingsTool.handler({
        pr_id: PR_ID,
        response_format: 'concise',
        limit: 20,
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(getResultText(result));
      expect(parsed).toEqual([]);
    });

    it('returns isError:true when fetchReviews fails', async () => {
      fetchReviewsMock.mockResolvedValue(
        makeErr('not_found', 'PR not found; verify the pr_id is correct'),
      );

      const result = await getFindingsTool.handler({
        pr_id: PR_ID,
        response_format: 'concise',
        limit: 20,
      });

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain('pr_id');
    });
  });
});
