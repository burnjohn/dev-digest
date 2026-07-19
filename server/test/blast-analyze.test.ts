import { describe, it, expect } from 'vitest';
import {
  analyzeCallSite,
  classifyCaller,
  enrichBlast,
  patchAddsThrow,
  patchChangesSignature,
  worstSeverity,
} from '../src/modules/blast/analyze.js';
import type { BlastRadius } from '@devdigest/shared';

describe('classifyCaller (deterministic caller role)', () => {
  it('A.P0.1 — test / boilerplate / business / normal by path + rank + endpoint reach', () => {
    expect(classifyCaller('src/api/user.test.ts')).toBe('test');
    expect(classifyCaller('server/__tests__/x.ts')).toBe('test');
    expect(classifyCaller('drizzle/migrations/0001_init.ts')).toBe('boilerplate');
    expect(classifyCaller('src/types/api.d.ts')).toBe('boilerplate');
    expect(classifyCaller('src/api/handler.ts', { hasEndpointOrCron: true })).toBe('business');
    expect(classifyCaller('src/core/hub.ts', { rank: 99 })).toBe('business');
    expect(classifyCaller('src/util/misc.ts', { rank: 3 })).toBe('normal');
  });

  it('A.P1.1 — test path wins even when the file is endpoint-reachable', () => {
    expect(classifyCaller('src/api/user.test.ts', { hasEndpointOrCron: true, rank: 99 })).toBe('test');
  });
});

describe('analyzeCallSite (loop / try-guard from source)', () => {
  const src = [
    'export function boot() {', // 1
    '  try {', // 2
    '    init();', // 3  ← guarded, not in loop
    '  } catch (e) {}', // 4
    '  for (const u of users) {', // 5
    '    rateLimit(u);', // 6  ← in loop, unguarded
    '  }', // 7
    '  plain();', // 8  ← neither
    '}', // 9
  ];

  it('A.P0.2 — flags a call inside a for-loop as in-loop (perf risk)', () => {
    expect(analyzeCallSite(src, 6)).toEqual({ inLoop: true, guarded: false });
  });

  it('A.P0.3 — flags a call inside try/catch as guarded (not a stability risk)', () => {
    expect(analyzeCallSite(src, 3)).toEqual({ inLoop: false, guarded: true });
  });

  it('A.P1.2 — a plain call is neither in-loop nor guarded', () => {
    expect(analyzeCallSite(src, 8)).toEqual({ inLoop: false, guarded: false });
  });

  it('A.P1.3 — detects .forEach(...) callbacks as loops too', () => {
    const s = ['items.forEach((it) => {', '  touch(it);', '});'];
    expect(analyzeCallSite(s, 2).inLoop).toBe(true);
  });
});

describe('patchAddsThrow + worstSeverity', () => {
  it('A.P0.4 — patchAddsThrow only counts ADDED throw lines', () => {
    expect(patchAddsThrow('@@\n+  throw new Error("x");\n   ok();')).toBe(true);
    expect(patchAddsThrow('@@\n-  throw new Error("removed");\n   ok();')).toBe(false);
    expect(patchAddsThrow('+++ b/file.ts\n+ const throwaway = 1;')).toBe(false); // word-boundary
    expect(patchAddsThrow(null)).toBe(false);
  });

  it('A.P1.4 — worstSeverity ranks CRITICAL > WARNING > SUGGESTION', () => {
    expect(worstSeverity(['SUGGESTION', 'CRITICAL', 'WARNING'])).toBe('CRITICAL');
    expect(worstSeverity(['SUGGESTION', 'WARNING'])).toBe('WARNING');
    expect(worstSeverity([])).toBeNull();
  });
});

describe('patchChangesSignature (breaking API/interface change)', () => {
  it('A.P0.7 — true when a function/interface DECLARATION line was edited (params changed)', () => {
    const fn = '@@\n-export function rateLimit(req) {\n+export function rateLimit(req, opts) {';
    expect(patchChangesSignature(fn, 'rateLimit')).toBe(true);
    const iface = '@@\n-  charge(amount: number): void\n+  charge(amount: number, card: string): void';
    expect(patchChangesSignature(iface, 'charge')).toBe(true);
  });

  it('A.P1.5 — false when only the body changed (declaration untouched)', () => {
    const body = '@@\n export function rateLimit(req, opts) {\n-  const x = 1;\n+  const x = 2;\n }';
    expect(patchChangesSignature(body, 'rateLimit')).toBe(false);
    expect(patchChangesSignature(null, 'rateLimit')).toBe(false);
  });
});

describe('enrichBlast (findings cross-ref + dead symbols + related PRs)', () => {
  const base: BlastRadius = {
    changed_symbols: [
      { name: 'rateLimit', file: 'src/mw/ratelimit.ts', kind: 'function' },
      { name: 'unusedHelper', file: 'src/mw/ratelimit.ts', kind: 'function' },
    ],
    downstream: [
      {
        symbol: 'rateLimit',
        file: 'src/mw/ratelimit.ts',
        callers: [{ name: 'h', file: 'src/api/public.ts', line: 3, role: 'business', in_loop: false, unguarded: false }],
        endpoints_affected: ['GET /x'],
        crons_affected: [],
        finding_severity: null,
        finding_count: 0,
        may_throw: false,
      },
    ],
    dead_symbols: [],
    related_prs: [],
    findings_available: false,
    summary: 's',
  };

  it('A.P0.5 — attributes the worst finding on the changed file to that symbol', () => {
    const out = enrichBlast(base, {
      findings: [
        { file: 'src/mw/ratelimit.ts', severity: 'WARNING' },
        { file: 'src/mw/ratelimit.ts', severity: 'CRITICAL' },
        { file: 'src/other.ts', severity: 'CRITICAL' },
      ],
      hasReview: true,
      relatedPrs: [{ id: 'p9', number: 9, title: 'earlier limiter tweak' }],
    });
    expect(out.downstream[0]!.finding_severity).toBe('CRITICAL');
    expect(out.downstream[0]!.finding_count).toBe(2); // only the two on this file
    expect(out.findings_available).toBe(true);
    expect(out.related_prs).toHaveLength(1);
  });

  it('A.P0.6 — surfaces changed symbols with no external callers as dead_symbols', () => {
    const out = enrichBlast(base, { findings: [], hasReview: false, relatedPrs: [] });
    expect(out.dead_symbols.map((s) => s.name)).toEqual(['unusedHelper']);
    expect(out.findings_available).toBe(false); // no review ran → "not run", not "0 findings"
  });
});
