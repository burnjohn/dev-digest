/**
 * brief-composer unit tests — pure functions, hermetic.
 * composeRisks: deterministic Finding → Risk derivation (zero LLM calls).
 * composePrBrief: full PrBrief assembly parses with the shared Zod contract.
 */
import { describe, it, expect } from 'vitest';
import { composeRisks, composePrBrief } from '../src/modules/reviews/brief-composer.js';
import { PrBrief, type BlastResponse, type Finding } from '@devdigest/shared';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'WARNING',
    category: 'bug',
    title: 'Missing null check',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'Value can be undefined here.',
    confidence: 0.9,
    ...overrides,
  } as Finding;
}

function makeBlastResponse(overrides: Partial<BlastResponse> = {}): BlastResponse {
  return {
    available: true,
    blast: {
      changed_symbols: [{ name: 'fn1', file: 'src/a.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'fn1',
          callers: [{ name: 'handler', file: 'src/b.ts', line: 3 }],
          endpoints_affected: ['GET /x'],
          crons_affected: [],
        },
      ],
      summary: '1 symbol changed · 1 caller · 1 endpoint · 0 crons reachable',
    },
    history: { history: [] },
    index: { status: 'full', degraded: false, reason: null },
    link: { owner: 'acme', repo: 'api', head_sha: 'abc' },
    ...overrides,
  };
}

describe('composeRisks', () => {
  it('maps CRITICAL→high and WARNING→medium; SUGGESTION excluded', () => {
    const { risks } = composeRisks([
      makeFinding({ id: 'c', severity: 'CRITICAL', category: 'security', title: 'Secret committed' }),
      makeFinding({ id: 'w', severity: 'WARNING', title: 'N+1 query' }),
      makeFinding({ id: 's', severity: 'SUGGESTION', title: 'Rename var' }),
    ]);

    expect(risks).toHaveLength(2);
    expect(risks[0]).toMatchObject({ kind: 'security', title: 'Secret committed', severity: 'high' });
    expect(risks[1]).toMatchObject({ title: 'N+1 query', severity: 'medium' });
  });

  it('orders CRITICAL before WARNING regardless of input order', () => {
    const { risks } = composeRisks([
      makeFinding({ severity: 'WARNING', title: 'warn' }),
      makeFinding({ severity: 'CRITICAL', title: 'crit' }),
    ]);
    expect(risks.map((r) => r.title)).toEqual(['crit', 'warn']);
  });

  it('dedupes by title and caps at 6', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeFinding({ id: `w${i}`, title: `Issue ${i}` }),
    );
    const dupes = [makeFinding({ title: 'Same' }), makeFinding({ id: 'x', title: 'Same' })];

    expect(composeRisks(dupes).risks).toHaveLength(1);
    expect(composeRisks(many).risks).toHaveLength(6);
  });

  it('builds file_refs as file:start_line and truncates long rationales', () => {
    const long = 'x'.repeat(500);
    const { risks } = composeRisks([
      makeFinding({ file: 'src/pay.ts', start_line: 42, rationale: long }),
    ]);
    expect(risks[0]!.file_refs).toEqual(['src/pay.ts:42']);
    expect(risks[0]!.explanation.length).toBeLessThanOrEqual(200);
    expect(risks[0]!.explanation.endsWith('…')).toBe(true);
  });
});

describe('composePrBrief', () => {
  it('assembles a PrBrief that parses with the shared Zod contract', () => {
    const brief = composePrBrief({
      intent: { intent: 'Add rate limiting', in_scope: ['a'], out_of_scope: [] },
      blastResponse: makeBlastResponse(),
      findings: [makeFinding({ severity: 'CRITICAL', category: 'security' })],
    });

    expect(() => PrBrief.parse(brief)).not.toThrow();
    expect(brief.blast.downstream).toHaveLength(1);
    expect(brief.risks.risks).toHaveLength(1);
  });

  it('falls back to an empty intent and empty blast when sources are missing', () => {
    const brief = composePrBrief({
      intent: undefined,
      blastResponse: makeBlastResponse({ available: false, blast: null }),
      findings: [],
    });

    expect(() => PrBrief.parse(brief)).not.toThrow();
    expect(brief.intent).toEqual({ intent: '', in_scope: [], out_of_scope: [] });
    expect(brief.blast.changed_symbols).toEqual([]);
    expect(brief.risks.risks).toEqual([]);
  });
});
