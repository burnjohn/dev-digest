/**
 * brief-generator-helpers unit tests — pure functions, hermetic (no DB/network).
 * Covers: budget drop-order, all 3 reference-validation tiers + drop case
 * (including Tier-2 zero-match / multiple-match sub-cases), and
 * `buildGithubBlobLink` output shape.
 */
import { describe, it, expect } from 'vitest';
import {
  assembleLlmInput,
  validateReferences,
  buildGithubBlobLink,
  firstChangedLineFromPatch,
  BRIEF_INPUT_TOKEN_BUDGET,
  type BriefInputFacts,
  type KnownFacts,
} from '../src/modules/reviews/brief-generator-helpers.js';
import type { Intent } from '@devdigest/shared';

const EMPTY_INTENT: Intent = { intent: 'Add caching layer', in_scope: ['cache'], out_of_scope: ['auth'] };

function makeFacts(overrides: Partial<BriefInputFacts> = {}): BriefInputFacts {
  return {
    intent: EMPTY_INTENT,
    blastSummary: {
      summary: '1 symbol changed · 1 caller · 1 endpoint · 0 crons reachable',
      topDownstream: [
        {
          symbol: 'fn1',
          callers: [{ name: 'handler', file: 'src/b.ts', line: 3 }],
          endpoints_affected: ['GET /x'],
          crons_affected: [],
        },
      ],
    },
    diffStats: [
      { path: 'src/services/foo.service.ts', role: 'core', additions: 10, deletions: 2, pseudocode_summary: 'adds caching' },
      { path: 'src/routes.ts', role: 'wiring', additions: 3, deletions: 0, pseudocode_summary: 'wires new route' },
      { path: 'package-lock.json', role: 'boilerplate', additions: 100, deletions: 50, pseudocode_summary: null },
    ],
    findings: [
      { title: 'N+1 query', rationale: 'Loop issues a query per item.' },
    ],
    prTitle: 'Add caching layer',
    prBody: 'This PR adds a caching layer to reduce DB load.',
    history: [
      { pr_number: 42, title: 'Prior cache PR', merged_at: '2026-01-01', author: 'alice', files_overlap: ['src/services/foo.service.ts'], notes: 'Similar change last time.' },
    ],
    contextExcerpts: [
      { path: 'docs/caching.md', content: 'Caching conventions for this repo.' },
    ],
    ...overrides,
  };
}

describe('assembleLlmInput', () => {
  it('includes all sections and fits when countTokens reports under budget', () => {
    const facts = makeFacts();
    const countTokens = () => 100; // always under budget
    const result = assembleLlmInput(facts, countTokens);

    expect(result.sectionsIncluded).toEqual([
      'intent',
      'blast_summary',
      'diff_stats',
      'findings',
      'pr_body',
      'history',
      'context_excerpts',
    ]);
    expect(result.sectionsDropped).toEqual([]);
    expect(result.input).toContain('## Intent');
    expect(result.input).toContain('## Blast summary');
    expect(result.input).toContain('## Diff stats');
    expect(result.input).toContain('## Findings');
    expect(result.input).toContain('## PR');
    expect(result.input).toContain('## History notes');
    expect(result.input).toContain('## Context excerpts');
  });

  it('drops sections in EXACT order 7 (context) -> 6 (history) -> halve 3 (diff stats), stopping as soon as it fits', () => {
    const facts = makeFacts();

    // Fake countTokens: simulate a budget that only fits once BOTH context (7)
    // and history (6) are dropped, but does NOT require halving diff stats (3).
    // We assert this by inspecting which sections are present in the "under
    // budget" check calls via call-order tracking.
    const callInputs: string[] = [];
    const countTokens = (s: string) => {
      callInputs.push(s);
      const overContext = s.includes('## Context excerpts');
      const overHistory = s.includes('## History notes');
      if (overContext || overHistory) return BRIEF_INPUT_TOKEN_BUDGET + 1; // still over budget
      return BRIEF_INPUT_TOKEN_BUDGET - 1; // fits once both are gone
    };

    const result = assembleLlmInput(facts, countTokens);

    // Section 7 must be dropped before section 6, and section 3 must NOT be
    // halved (diff stats cap stays at 15, i.e. all 3 fixture files present).
    expect(result.sectionsDropped).toEqual(['context_excerpts', 'history']);
    expect(result.sectionsIncluded).toEqual(['intent', 'blast_summary', 'diff_stats', 'findings', 'pr_body']);
    expect(result.input).not.toContain('## Context excerpts');
    expect(result.input).not.toContain('## History notes');
    // diff stats section still contains all 3 fixture files (not halved)
    expect(result.input).toContain('src/services/foo.service.ts');
    expect(result.input).toContain('src/routes.ts');
    expect(result.input).toContain('package-lock.json');

    // Verify the drop order by checking the sequence of build() attempts:
    // 1st call = full build (has both context + history)
    // 2nd call = context dropped, history still present
    // 3rd call = both dropped -> fits
    expect(callInputs[0]).toContain('## Context excerpts');
    expect(callInputs[0]).toContain('## History notes');
    expect(callInputs[1]).not.toContain('## Context excerpts');
    expect(callInputs[1]).toContain('## History notes');
    expect(callInputs[2]).not.toContain('## Context excerpts');
    expect(callInputs[2]).not.toContain('## History notes');
  });

  it('halves diff stats (top 8) as the last resort when dropping 7 and 6 is not enough, and the result then fits', () => {
    // Build diffStats with more than 8 core-role files so we can observe the halving.
    const manyFiles = Array.from({ length: 15 }, (_, i) => ({
      path: `src/services/file${i}.service.ts`,
      role: 'core' as const,
      additions: 1,
      deletions: 0,
      pseudocode_summary: `summary ${i}`,
    }));
    const facts = makeFacts({ diffStats: manyFiles });

    let callCount = 0;
    const countTokens = () => {
      callCount++;
      // Over budget for calls 1-3 (full, no-context, no-context-no-history),
      // fits on call 4 (halved diff stats).
      return callCount < 4 ? BRIEF_INPUT_TOKEN_BUDGET + 1 : BRIEF_INPUT_TOKEN_BUDGET - 1;
    };

    const result = assembleLlmInput(facts, countTokens);

    expect(result.sectionsDropped).toEqual(['context_excerpts', 'history']);
    expect(result.sectionsIncluded).toContain('diff_stats');
    // Halved cap = 8 files, not 15.
    expect(result.input).toContain('file0.service.ts');
    expect(result.input).toContain('file7.service.ts');
    expect(result.input).not.toContain('file8.service.ts');
    expect(result.input).not.toContain('file14.service.ts');
    expect(countTokens(result.input)).toBeLessThanOrEqual(BRIEF_INPUT_TOKEN_BUDGET - 1);
  });

  it('never drops the intent section, even when still over budget after all drops', () => {
    const facts = makeFacts();
    const alwaysOverBudget = () => Number.MAX_SAFE_INTEGER; // never fits, never throws
    const result = assembleLlmInput(facts, alwaysOverBudget);

    expect(result.sectionsIncluded).toContain('intent');
    expect(result.sectionsDropped).not.toContain('intent');
    expect(result.input).toContain('## Intent');
    // Best-effort: fully dropped 7+6, halved 3 — still returns rather than throwing.
    expect(result.sectionsDropped).toEqual(['context_excerpts', 'history']);
  });

  it('sorts diff stats core -> wiring -> boilerplate regardless of input order', () => {
    const facts = makeFacts({
      diffStats: [
        { path: 'a.lock', role: 'boilerplate', additions: 1, deletions: 0, pseudocode_summary: null },
        { path: 'wiring.ts', role: 'wiring', additions: 1, deletions: 0, pseudocode_summary: null },
        { path: 'core.service.ts', role: 'core', additions: 1, deletions: 0, pseudocode_summary: null },
      ],
    });
    const result = assembleLlmInput(facts, () => 0);
    const idxCore = result.input.indexOf('core.service.ts');
    const idxWiring = result.input.indexOf('wiring.ts');
    const idxBoilerplate = result.input.indexOf('a.lock');
    expect(idxCore).toBeGreaterThan(-1);
    expect(idxCore).toBeLessThan(idxWiring);
    expect(idxWiring).toBeLessThan(idxBoilerplate);
  });

  it('truncates pseudocode_summary, finding rationale, and history notes (150/300 char caps)', () => {
    const longStr = 'x'.repeat(1000);
    const facts = makeFacts({
      diffStats: [{ path: 'src/services/foo.service.ts', role: 'core', additions: 1, deletions: 0, pseudocode_summary: longStr }],
      findings: [{ title: 'Long finding', rationale: longStr }],
      history: [{ pr_number: 1, title: 't', merged_at: '2026-01-01', author: 'a', files_overlap: [], notes: longStr }],
    });
    const result = assembleLlmInput(facts, () => 0);
    // Full 1000-char string should never appear verbatim for these fields.
    expect(result.input).not.toContain(longStr);
  });

  it('truncates PR body at MAX_PR_BODY_CHARS (4000 chars)', () => {
    const veryLongBody = 'y'.repeat(5000);
    const facts = makeFacts({ prBody: veryLongBody });
    const result = assembleLlmInput(facts, () => 0);
    expect(result.input).not.toContain(veryLongBody);
    expect(result.input).toContain('y'.repeat(3999));
  });
});

describe('validateReferences', () => {
  const knownFacts: KnownFacts = {
    knownFiles: new Set(['src/services/foo.service.ts', 'src/routes.ts']),
    knownSymbols: new Map([['fooHandler', 'src/services/foo.service.ts']]),
    knownEndpoints: new Set(['GET /users/:id', 'POST /orders']),
  };

  it('Tier 1: exact file match resolves and passes through an absent line as-is (no 1-default)', () => {
    const [result] = validateReferences([{ file: 'src/routes.ts' }], knownFacts);
    expect(result).toEqual({ resolved: true, file: 'src/routes.ts', symbol: undefined, line: undefined });
  });

  it('Tier 1: exact symbol match repairs file from the symbol map', () => {
    const [result] = validateReferences([{ symbol: 'fooHandler', line: 42 }], knownFacts);
    expect(result).toEqual({ resolved: true, file: 'src/services/foo.service.ts', symbol: 'fooHandler', line: 42 });
  });

  it('passes through a meaningless line: 1 from the LLM unchanged (no special-casing here — caller decides)', () => {
    const [result] = validateReferences([{ symbol: 'fooHandler', line: 1 }], knownFacts);
    expect(result).toEqual({ resolved: true, file: 'src/services/foo.service.ts', symbol: 'fooHandler', line: 1 });
  });

  it('Tier 2: basename repair when exactly one knownFiles entry shares the basename', () => {
    const [result] = validateReferences([{ file: 'somewhere/else/foo.service.ts' }], knownFacts);
    expect(result).toEqual({ resolved: true, file: 'src/services/foo.service.ts', symbol: undefined, line: undefined });
  });

  it('Tier 2: zero basename matches falls through to no match (never guesses)', () => {
    const [result] = validateReferences([{ file: 'nowhere/unknown-file.ts' }], knownFacts);
    expect(result).toEqual({ resolved: false });
  });

  it('Tier 2: multiple basename matches falls through to no match (never guesses among ambiguous candidates)', () => {
    const ambiguousFacts: KnownFacts = {
      knownFiles: new Set(['pkg-a/index.ts', 'pkg-b/index.ts']),
      knownSymbols: new Map(),
      knownEndpoints: new Set(),
    };
    const [result] = validateReferences([{ file: 'somewhere/index.ts' }], ambiguousFacts);
    expect(result).toEqual({ resolved: false });
  });

  it('Tier 3: exact endpoint match resolves', () => {
    const [result] = validateReferences([{ endpoint: 'POST /orders' }], knownFacts);
    expect(result).toEqual({ resolved: true, endpoint: 'POST /orders', line: undefined });
  });

  it('Tier 3: normalized endpoint match (braces vs colon-param) resolves', () => {
    const [result] = validateReferences([{ endpoint: 'GET /users/{id}' }], knownFacts);
    expect(result).toEqual({ resolved: true, endpoint: 'GET /users/:id', line: undefined });
  });

  it('drop case: no match in any tier returns { resolved: false }', () => {
    const [result] = validateReferences(
      [{ file: 'nope.ts', symbol: 'unknownSymbol', endpoint: 'DELETE /nothing' }],
      knownFacts,
    );
    expect(result).toEqual({ resolved: false });
  });

  it('processes multiple entries independently in the input order', () => {
    const results = validateReferences(
      [{ symbol: 'fooHandler' }, { file: 'totally/unknown.ts' }, { endpoint: 'POST /orders' }],
      knownFacts,
    );
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ resolved: true, symbol: 'fooHandler' });
    expect(results[1]).toEqual({ resolved: false });
    expect(results[2]).toMatchObject({ resolved: true, endpoint: 'POST /orders' });
  });
});

describe('firstChangedLineFromPatch', () => {
  it('returns null for null/undefined/empty patch', () => {
    expect(firstChangedLineFromPatch(null)).toBeNull();
    expect(firstChangedLineFromPatch(undefined)).toBeNull();
    expect(firstChangedLineFromPatch('')).toBeNull();
  });

  it('returns null when no hunk header is found', () => {
    expect(firstChangedLineFromPatch('just some text\nwith no diff markers')).toBeNull();
  });

  it('returns the first ACTUAL added line, not just the hunk start', () => {
    // Hunk starts at new-side line 40; first two lines are context (40, 41);
    // the first "+" line lands at new-side line 42.
    const patch = [
      '@@ -38,5 +40,6 @@',
      ' context line at 40',
      ' context line at 41',
      '+added line at 42',
      '+added line at 43',
      ' context line at 44',
    ].join('\n');
    expect(firstChangedLineFromPatch(patch)).toBe(42);
  });

  it('returns the hunk start when the first hunk has only context lines (no "+")', () => {
    const patch = [
      '@@ -10,3 +10,3 @@',
      ' context line at 10',
      ' context line at 11',
      ' context line at 12',
    ].join('\n');
    expect(firstChangedLineFromPatch(patch)).toBe(10);
  });

  it('first hunk wins when multiple hunks are present', () => {
    const patch = [
      '@@ -5,2 +5,3 @@',
      ' context at 5',
      '+added at 6',
      '@@ -100,2 +101,3 @@',
      ' context at 101',
      '+added at 102',
    ].join('\n');
    expect(firstChangedLineFromPatch(patch)).toBe(6);
  });

  it('does not increment the new-side counter on removed ("-") lines', () => {
    const patch = [
      '@@ -1,4 +1,3 @@',
      '-removed line',
      ' context at 1',
      '-another removed line',
      '+added at 2',
    ].join('\n');
    expect(firstChangedLineFromPatch(patch)).toBe(2);
  });

  it('ignores the "+++" file header line (not a real added line)', () => {
    const patch = [
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,2 +1,3 @@',
      ' context at 1',
      '+added at 2',
    ].join('\n');
    expect(firstChangedLineFromPatch(patch)).toBe(2);
  });

  it('handles a hunk header with omitted length on the new side (single-line hunk)', () => {
    const patch = ['@@ -1 +1 @@', '-old', '+new'].join('\n');
    expect(firstChangedLineFromPatch(patch)).toBe(1);
  });
});

describe('buildGithubBlobLink', () => {
  it('builds the exact URL shape with a line number', () => {
    const url = buildGithubBlobLink('acme/api', 'abc123', 'src/services/foo.service.ts', 42);
    expect(url).toBe('https://github.com/acme/api/blob/abc123/src/services/foo.service.ts#L42');
  });

  it('omits #L when no line is given', () => {
    const url = buildGithubBlobLink('acme/api', 'abc123', 'src/services/foo.service.ts');
    expect(url).toBe('https://github.com/acme/api/blob/abc123/src/services/foo.service.ts');
  });

  it('encodes path segments while preserving "/" separators', () => {
    const url = buildGithubBlobLink('acme/api', 'abc123', 'src/some dir/weird name.ts', 7);
    expect(url).toBe('https://github.com/acme/api/blob/abc123/src/some%20dir/weird%20name.ts#L7');
  });
});
