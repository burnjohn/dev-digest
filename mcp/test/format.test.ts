import { describe, it, expect } from 'vitest';
import {
  projectAgent,
  projectBlastLive,
  projectConvention,
  paginateFindings,
  conciseReviewSummary,
} from '../src/format.js';
import type { BlastResponse } from '@devdigest/shared';
import {
  makeAgent,
  makeConvention,
  makeReviewRecord,
  makeFinding,
} from './setup.js';

// ── Blast fixtures ───────────────────────────────────────────────────────────

function makeBlastResponse(overrides: Partial<BlastResponse> = {}): BlastResponse {
  return {
    available: true,
    blast: {
      summary: '2 symbols · 6 callers · 2 endpoints',
      changed_symbols: [
        { name: 'getCache', file: 'src/cache.ts', kind: 'function' },
        { name: 'setCache', file: 'src/cache.ts', kind: 'function' },
      ],
      downstream: [
        {
          symbol: 'useCache',
          callers: [
            { name: 'A', file: 'src/a.ts', line: 1 },
            { name: 'B', file: 'src/b.ts', line: 2 },
            { name: 'C', file: 'src/c.ts', line: 3 },
            { name: 'D', file: 'src/d.ts', line: 4 },
            { name: 'E', file: 'src/e.ts', line: 5 },
            { name: 'F', file: 'src/f.ts', line: 6 },
          ],
          endpoints_affected: ['/api/data', '/api/cache'],
          crons_affected: ['nightly-sync'],
        },
      ],
    },
    history: {
      history: [
        { pr_number: 10, title: 'PR Alpha', merged_at: '2026-05-01T00:00:00Z', author: 'alice', files_overlap: [], notes: '' },
        { pr_number: 11, title: 'PR Beta', merged_at: '2026-05-02T00:00:00Z', author: 'bob', files_overlap: [], notes: '' },
        { pr_number: 12, title: 'PR Gamma', merged_at: '2026-05-03T00:00:00Z', author: 'carol', files_overlap: [], notes: '' },
        { pr_number: 13, title: 'PR Delta', merged_at: '2026-05-04T00:00:00Z', author: 'dave', files_overlap: [], notes: '' },
      ],
    },
    index: { status: 'full', degraded: false, reason: null },
    link: { owner: 'acme', repo: 'my-app', head_sha: 'abc123' },
    ...overrides,
  };
}

function makeBlastUnavailable(status: 'degraded' | 'failed' | 'partial' = 'degraded', reason?: string): BlastResponse {
  return {
    available: false,
    blast: null,
    history: { history: [] },
    index: { status, degraded: true, reason: reason ?? null },
    link: null,
  };
}

describe('format', () => {
  describe('projectAgent', () => {
    it('projects only the allowed fields and drops sensitive ones', () => {
      const agent = makeAgent({
        system_prompt: 'SECRET PROMPT',
        output_schema: { type: 'object' },
        version: 42,
        strategy: 'map-reduce',
        ci_fail_on: 'any',
        repo_intel: false,
      });

      const projected = projectAgent(agent);

      // Allowed fields
      expect(projected.id).toBe(agent.id);
      expect(projected.name).toBe(agent.name);
      expect(projected.description).toBe(agent.description);
      expect(projected.provider).toBe(agent.provider);
      expect(projected.model).toBe(agent.model);
      expect(projected.enabled).toBe(agent.enabled);

      // Dropped fields must not appear
      expect(projected).not.toHaveProperty('system_prompt');
      expect(projected).not.toHaveProperty('output_schema');
      expect(projected).not.toHaveProperty('version');
      expect(projected).not.toHaveProperty('strategy');
      expect(projected).not.toHaveProperty('ci_fail_on');
      expect(projected).not.toHaveProperty('repo_intel');
    });
  });

  describe('projectConvention', () => {
    it('uses edited_rule when present, falls back to rule', () => {
      const withEdited = makeConvention('accepted', {
        rule: 'Original rule',
        edited_rule: 'Edited rule',
      });
      expect(projectConvention(withEdited).rule).toBe('Edited rule');

      const noEdited = makeConvention('accepted', {
        rule: 'Only rule',
        edited_rule: undefined,
      });
      expect(projectConvention(noEdited).rule).toBe('Only rule');
    });

    it('defaults category to uncategorized when absent', () => {
      const c = makeConvention('verified', { category: undefined });
      expect(projectConvention(c).category).toBe('uncategorized');
    });
  });

  describe('paginateFindings', () => {
    it('returns has_more:true and items.length===20 when total is 25 and limit is 20', () => {
      const findings = Array.from({ length: 25 }, (_, i) =>
        makeFinding('WARNING', String(i + 1)),
      );
      const review = makeReviewRecord({ findings });

      const result = paginateFindings([review], 20);

      expect(result.total).toBe(25);
      expect(result.has_more).toBe(true);
      expect(result.items).toHaveLength(20);
    });

    it('returns has_more:false when total is within limit', () => {
      const findings = Array.from({ length: 5 }, (_, i) =>
        makeFinding('SUGGESTION', String(i + 1)),
      );
      const review = makeReviewRecord({ findings });

      const result = paginateFindings([review], 20);

      expect(result.total).toBe(5);
      expect(result.has_more).toBe(false);
      expect(result.items).toHaveLength(5);
    });

    it('sorts findings CRITICAL → WARNING → SUGGESTION', () => {
      const findings = [
        makeFinding('SUGGESTION', '1'),
        makeFinding('CRITICAL', '2'),
        makeFinding('WARNING', '3'),
      ];
      const review = makeReviewRecord({ findings });

      const result = paginateFindings([review]);

      expect(result.items[0]?.severity).toBe('CRITICAL');
      expect(result.items[1]?.severity).toBe('WARNING');
      expect(result.items[2]?.severity).toBe('SUGGESTION');
    });

    it('caps limit at 50 when a higher limit is requested', () => {
      const findings = Array.from({ length: 60 }, (_, i) =>
        makeFinding('WARNING', String(i + 1)),
      );
      const review = makeReviewRecord({ findings });

      const result = paginateFindings([review], 100);

      expect(result.items).toHaveLength(50);
      expect(result.has_more).toBe(true);
    });
  });

  describe('projectBlastLive', () => {
    it('returns available:false with actionable reason and index when blast is unavailable (degraded)', () => {
      const data = makeBlastUnavailable('degraded', 'ripgrep fallback failed');
      const result = projectBlastLive(data);

      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.reason).toBe('ripgrep fallback failed');
        expect(result.index.status).toBe('degraded');
        expect(result.index.degraded).toBe(true);
      }
    });

    it('returns available:false with derived reason when index.reason is null (failed status)', () => {
      const data = makeBlastUnavailable('failed');
      const result = projectBlastLive(data);

      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.reason).toMatch(/failed/i);
        expect(result.index.status).toBe('failed');
      }
    });

    it('returns available:false with derived reason for partial status', () => {
      const data = makeBlastUnavailable('partial');
      const result = projectBlastLive(data);

      expect(result.available).toBe(false);
      if (!result.available) {
        expect(result.reason).toMatch(/partial/i);
      }
    });

    it('returns available:true with correct aggregate counts', () => {
      const data = makeBlastResponse();
      const result = projectBlastLive(data);

      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.symbols_count).toBe(2);
        expect(result.callers_count).toBe(6);
        expect(result.endpoints_count).toBe(2);
        expect(result.crons_count).toBe(1);
        expect(result.summary).toBe('2 symbols · 6 callers · 2 endpoints');
      }
    });

    it('caps callers per symbol at 5 and records remaining count', () => {
      const data = makeBlastResponse(); // has 6 callers on 'useCache'
      const result = projectBlastLive(data);

      expect(result.available).toBe(true);
      if (result.available) {
        const sym = result.symbols[0];
        expect(sym).toBeDefined();
        if (sym) {
          expect(sym.callers).toHaveLength(5);
          expect(sym.remaining_callers).toBe(1); // 6 total - 5 shown = 1 remaining
          expect(sym.callers[0]?.ref).toBe('src/a.ts:1');
          expect(sym.callers[0]?.name).toBe('A');
          expect(sym.callers[4]?.ref).toBe('src/e.ts:5');
        }
      }
    });

    it('uses truncated map to add server-side clamped extras to remaining_callers', () => {
      // server shows 3 callers but has 10 more hidden (truncated.useCache = 10)
      const data = makeBlastResponse({
        blast: {
          summary: 'test',
          changed_symbols: [{ name: 'fn', file: 'src/f.ts', kind: 'function' }],
          downstream: [
            {
              symbol: 'fn',
              callers: [
                { name: 'A', file: 'src/a.ts', line: 1 },
                { name: 'B', file: 'src/b.ts', line: 2 },
                { name: 'C', file: 'src/c.ts', line: 3 },
              ],
              endpoints_affected: [],
              crons_affected: [],
            },
          ],
        },
        truncated: { fn: 10 },
      });
      const result = projectBlastLive(data);

      expect(result.available).toBe(true);
      if (result.available) {
        const sym = result.symbols[0];
        if (sym) {
          // 3 callers < 5 cap — all shown; remaining from truncated map
          expect(sym.callers).toHaveLength(3);
          expect(sym.remaining_callers).toBe(10);
        }
      }
    });

    it('limits prior_prs to top 3', () => {
      const data = makeBlastResponse(); // 4 history items in fixture
      const result = projectBlastLive(data);

      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.prior_prs).toHaveLength(3);
        expect(result.prior_prs[0]?.pr_number).toBe(10);
        expect(result.prior_prs[0]?.title).toBe('PR Alpha');
        expect(result.prior_prs[2]?.pr_number).toBe(12);
      }
    });

    it('passes index state through when available:true', () => {
      const data = makeBlastResponse({
        index: { status: 'partial', degraded: true, reason: 'some files missing' },
      });
      const result = projectBlastLive(data);

      expect(result.available).toBe(true);
      if (result.available) {
        expect(result.index.status).toBe('partial');
        expect(result.index.degraded).toBe(true);
        expect(result.index.reason).toBe('some files missing');
      }
    });

    it('returns available:false when blast field is null even if available flag is true', () => {
      // Edge case: malformed response — blast is null but available is true
      const data: BlastResponse = {
        available: true,
        blast: null,
        history: { history: [] },
        index: { status: 'full', degraded: false, reason: null },
        link: null,
      };
      const result = projectBlastLive(data);

      // projectBlastLive treats blast:null as unavailable regardless of available flag
      expect(result.available).toBe(false);
    });
  });

  describe('conciseReviewSummary', () => {
    it('omits finding bodies and computes findings_breakdown by severity', () => {
      const findings = [
        makeFinding('CRITICAL', '1'),
        makeFinding('WARNING', '2'),
        makeFinding('WARNING', '3'),
        makeFinding('SUGGESTION', '4'),
      ];
      const review = makeReviewRecord({ findings, verdict: 'request_changes', score: 30 });

      const result = conciseReviewSummary([review]);

      expect(result).toHaveLength(1);
      const entry = result[0]!;

      // No finding bodies
      expect(entry).not.toHaveProperty('findings');

      // Computed breakdown
      expect(entry.findings_breakdown).toEqual({ critical: 1, warning: 2, suggestion: 1 });
      expect(entry.verdict).toBe('request_changes');
      expect(entry.score).toBe(30);
      expect(entry.agent_name).toBe('Test Agent');
    });

    it('handles reviews with no findings — all counts are 0', () => {
      const review = makeReviewRecord({ findings: [] });
      const result = conciseReviewSummary([review]);

      expect(result[0]?.findings_breakdown).toEqual({ critical: 0, warning: 0, suggestion: 0 });
    });

    it('returns empty array for empty reviews input', () => {
      expect(conciseReviewSummary([])).toEqual([]);
    });
  });
});
