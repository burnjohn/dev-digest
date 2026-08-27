import { describe, it, expect } from 'vitest';
import type { BlastRadiusResponse, RiskBriefArea, RiskBriefFocusItem, RiskBriefGeneration } from '@devdigest/shared';
import { groundBrief } from '../src/modules/reviews/brief-grounding.js';

/**
 * Hermetic unit coverage for `brief-grounding.ts` (docs/plans/08-pr-risk-brief.md T4).
 * Pure function, no I/O — covers the membership test (REQ-6/7/8/13), the ungrounded-all
 * case (REQ-10), the fixed normalisation order (REQ-14/25/36), order preservation
 * (REQ-15), and the no-count-on-the-brief / no-retry invariants (REQ-9/37/46).
 */

function risk(overrides: Partial<RiskBriefArea> = {}): RiskBriefArea {
  return {
    title: 'A risk',
    explanation: 'Something risky happened here in enough detail to pass validation.',
    severity: 'medium',
    file: 'src/service.ts',
    endpoint: null,
    ...overrides,
  };
}

function focus(overrides: Partial<RiskBriefFocusItem> = {}): RiskBriefFocusItem {
  return {
    file: 'src/service.ts',
    reason: 'Central to the change',
    ...overrides,
  };
}

function generation(overrides: Partial<RiskBriefGeneration> = {}): RiskBriefGeneration {
  return {
    what: 'Adds a new endpoint',
    why: 'To support the new feature',
    risk_level: 'medium',
    risks: [],
    review_focus: [],
    ...overrides,
  };
}

/** Minimal, schema-satisfying `BlastRadiusResponse`. */
function blast(overrides: Partial<BlastRadiusResponse> = {}): BlastRadiusResponse {
  return {
    status: 'ok',
    status_reason: '',
    coverage: {
      callers_available: true,
      endpoints_available: true,
      crons_available: true,
      imports_available: true,
      prior_prs_available: true,
      files_indexed: 1,
      files_skipped: 0,
      index_truncated: false,
    },
    changed_file_count: 1,
    totals: { symbols: 0, callers: 0, endpoints: 0, crons: 0 },
    symbols: [],
    file_impact: [],
    prior_prs: [],
    narrative: null,
    ...overrides,
  };
}

describe('groundBrief', () => {
  it('drops risks and focus items citing paths outside the grounded set (REQ-6/7), but keeps a risk grounded only via blast', () => {
    const gen = generation({
      risks: [
        risk({ title: 'passwd', file: '/etc/passwd' }),
        risk({ title: 'traversal', file: '../../secrets.json' }),
        risk({ title: 'url', file: 'https://evil.example/steal' }),
        risk({ title: 'blast-only', file: 'src/blast-only.ts' }),
      ],
      review_focus: [
        focus({ file: '/etc/passwd', reason: 'read this file' }),
        focus({ file: '../../secrets.json' }),
        focus({ file: 'https://evil.example/steal' }),
      ],
    });

    const result = groundBrief(
      gen,
      ['src/service.ts'],
      blast({ symbols: [{ name: 'foo', file: 'src/blast-only.ts', kind: 'function', callers: [], caller_count: 0, chips: [] }] }),
    );

    expect(result.brief.risks).toHaveLength(1);
    expect(result.brief.risks[0]?.file).toBe('src/blast-only.ts');
    expect(result.brief.review_focus).toHaveLength(0);
    expect(result.counts.risks.grounded_dropped).toBe(3);
    expect(result.counts.review_focus.grounded_dropped).toBe(3);
  });

  it('nulls an ungrounded endpoint instead of dropping the risk, and nulls every endpoint when blast is unavailable (REQ-8)', () => {
    const gen = generation({
      risks: [risk({ file: 'src/service.ts', endpoint: 'GET /not-real' })],
    });

    const withBlast = groundBrief(
      gen,
      ['src/service.ts'],
      blast({
        symbols: [
          {
            name: 'handler',
            file: 'src/service.ts',
            kind: 'function',
            callers: [],
            caller_count: 0,
            chips: [{ label: 'GET /real', kind: 'endpoint', file: 'src/service.ts' }],
          },
        ],
      }),
    );
    expect(withBlast.brief.risks).toHaveLength(1);
    expect(withBlast.brief.risks[0]?.endpoint).toBeNull();

    const withoutBlast = groundBrief(
      generation({ risks: [risk({ file: 'src/service.ts', endpoint: 'GET /real' })] }),
      ['src/service.ts'],
      undefined,
    );
    expect(withoutBlast.brief.risks).toHaveLength(1);
    expect(withoutBlast.brief.risks[0]?.endpoint).toBeNull();
  });

  it('returns risks: [] with no throw when every risk is ungrounded (REQ-10)', () => {
    const gen = generation({
      risks: [risk({ file: 'nope.ts' }), risk({ file: 'also-nope.ts' })],
    });

    const result = groundBrief(gen, ['src/service.ts'], undefined);

    expect(result.brief.risks).toEqual([]);
    expect(result.counts.risks.grounded_dropped).toBe(2);
  });

  it('dedupes review_focus by file BEFORE the cap, so 7 items with one repeat return 6 distinct files, not 5 (REQ-36 + REQ-14)', () => {
    const paths = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'];
    const gen = generation({
      review_focus: [
        focus({ file: 'a.ts', reason: 'first' }),
        focus({ file: 'a.ts', reason: 'duplicate of first' }),
        focus({ file: 'b.ts' }),
        focus({ file: 'c.ts' }),
        focus({ file: 'd.ts' }),
        focus({ file: 'e.ts' }),
        focus({ file: 'f.ts' }),
      ],
    });

    const result = groundBrief(gen, paths, undefined);

    // Mutation caught: capping before dedupe would return 5 files (a,a-slot-wasted,b,c,d after
    // an 6-cap over 7 raw entries), never 6 distinct ones.
    const files = result.brief.review_focus.map((f) => f.file);
    expect(files).toHaveLength(6);
    expect(new Set(files).size).toBe(6);
    expect(files).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts']);
    expect(result.counts.review_focus.deduped).toBe(1);
  });

  it('preserves the input order of surviving review_focus entries (REQ-15)', () => {
    const gen = generation({
      review_focus: [focus({ file: 'z.ts' }), focus({ file: 'a.ts' }), focus({ file: 'm.ts' })],
    });

    const result = groundBrief(gen, ['z.ts', 'a.ts', 'm.ts'], undefined);

    expect(result.brief.review_focus.map((f) => f.file)).toEqual(['z.ts', 'a.ts', 'm.ts']);
  });

  it('truncates 12 grounded risks to 8 rather than raising (REQ-14)', () => {
    const paths = Array.from({ length: 12 }, (_, i) => `file-${i}.ts`);
    const gen = generation({ risks: paths.map((file) => risk({ file })) });

    const result = groundBrief(gen, paths, undefined);

    expect(result.brief.risks).toHaveLength(8);
    expect(result.counts.risks.capped).toBe(4);
  });

  it('drops a file with a line suffix, since a path with a line number is not a member of a set harvested from the database (REQ-13)', () => {
    const gen = generation({ risks: [risk({ file: 'src/config.ts:12' })] });

    const result = groundBrief(gen, ['src/config.ts'], undefined);

    expect(result.brief.risks).toEqual([]);
    expect(result.counts.risks.grounded_dropped).toBe(1);
  });

  it('returns counts that distinguish grounding drops, dedupe removals and cap removals, per list (REQ-25)', () => {
    const gen = generation({
      risks: [
        risk({ file: 'ungrounded.ts' }),
        ...Array.from({ length: 9 }, (_, i) => risk({ file: `ok-${i}.ts` })),
      ],
      review_focus: [
        focus({ file: 'ungrounded.ts' }),
        focus({ file: 'dup.ts' }),
        focus({ file: 'dup.ts' }),
        focus({ file: 'x1.ts' }),
        focus({ file: 'x2.ts' }),
        focus({ file: 'x3.ts' }),
        focus({ file: 'x4.ts' }),
        focus({ file: 'x5.ts' }),
      ],
    });
    const paths = [
      ...Array.from({ length: 9 }, (_, i) => `ok-${i}.ts`),
      'dup.ts',
      'x1.ts',
      'x2.ts',
      'x3.ts',
      'x4.ts',
      'x5.ts',
    ];

    const result = groundBrief(gen, paths, undefined);

    expect(result.counts).toEqual({
      risks: { grounded_dropped: 1, capped: 1 },
      review_focus: { grounded_dropped: 1, deduped: 1, capped: 0 },
    });
  });

  it('carries no count field on the returned brief, and every surviving risk has a non-empty file (REQ-9/37)', () => {
    const gen = generation({
      risks: [risk({ file: 'src/service.ts' })],
      review_focus: [focus({ file: 'src/service.ts' })],
    });

    const result = groundBrief(gen, ['src/service.ts'], undefined);

    expect(result.brief).not.toHaveProperty('counts');
    expect(result.brief).not.toHaveProperty('grounded_dropped');
    for (const r of result.brief.risks) {
      expect(r.file.length).toBeGreaterThan(0);
    }
  });

  it('performs no retry, re-prompt, repair or category handling — the output carries exactly what/why/risk_level/risks/review_focus (REQ-46)', () => {
    const gen = generation({ risks: [risk({ file: 'src/service.ts' })] });

    const result = groundBrief(gen, ['src/service.ts'], undefined);

    expect(Object.keys(result.brief).sort()).toEqual(
      ['review_focus', 'risk_level', 'risks', 'what', 'why'].sort(),
    );
    expect(result.brief).not.toHaveProperty('category');
  });

  it('treats membership as exact string equality after trimming — not a prefix/suffix/basename match', () => {
    const gen = generation({
      risks: [
        risk({ title: 'suffix', file: 'src/service.ts.bak' }),
        risk({ title: 'prefix', file: 'other/src/service.ts' }),
        risk({ title: 'basename-only', file: 'service.ts' }),
        risk({ title: 'whitespace', file: '  src/service.ts  ' }),
      ],
    });

    const result = groundBrief(gen, ['src/service.ts'], undefined);

    expect(result.brief.risks).toHaveLength(1);
    expect(result.brief.risks[0]?.title).toBe('whitespace');
  });
});
