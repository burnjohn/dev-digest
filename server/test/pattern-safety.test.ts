import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { RipgrepCodeIndex } from '../src/adapters/codeindex/ripgrep.js';
import {
  compileSafeRegex,
  isSafePattern,
  literalContentLength,
  MAX_PATTERN_CHARS,
} from '../src/platform/pattern-safety.js';
import { buildRgArgs } from '../src/adapters/codeindex/ripgrep.js';
import { MockCodeIndex } from '../src/adapters/mocks.js';

/**
 * The shared pattern trust gate, and the two things that depend on it being right:
 * ripgrep's argv, and the fact that both grep engines refuse the same set.
 *
 * Every case here is an adversarial input. A pattern reaches this code from a
 * model or from repo content, and Node cannot interrupt a regex once it starts —
 * so what is REFUSED is the entire safety property.
 */

describe('isSafePattern — the ReDoS dialect', () => {
  it('refuses star-height >= 2 and quantified ambiguous alternation', () => {
    for (const p of ['(a+)+$', '(a|a)*b', '(.*)*x', '(\\s*\\w+)+b', '(x?y+)+z']) {
      expect(isSafePattern(p)).toEqual({ ok: false, reason: 'nested_quantifier' });
    }
  });

  it('refuses unbounded and oversized repetition', () => {
    expect(isSafePattern('abc{1,}')).toEqual({ ok: false, reason: 'unbounded_repetition' });
    expect(isSafePattern('abc{2,}')).toEqual({ ok: false, reason: 'unbounded_repetition' });
    expect(isSafePattern('abc{500}')).toEqual({ ok: false, reason: 'unbounded_repetition' });
    // A small bounded repeat is fine.
    expect(isSafePattern('abc{2,4}')).toEqual({ ok: true });
  });

  it('refuses lookaround and backreferences', () => {
    // Both are backtracking amplifiers AND unsupported by Rust's `regex`, which
    // is what keeps a pattern meaning the same thing in ripgrep and in JS.
    expect(isSafePattern('foo(?=bar)')).toEqual({ ok: false, reason: 'lookaround' });
    expect(isSafePattern('foo(?!bar)')).toEqual({ ok: false, reason: 'lookaround' });
    expect(isSafePattern('(?<=a)foo')).toEqual({ ok: false, reason: 'lookaround' });
    expect(isSafePattern('(abc)\\1')).toEqual({ ok: false, reason: 'backreference' });
  });

  it('refuses an empty, over-long or unparseable pattern', () => {
    expect(isSafePattern('')).toEqual({ ok: false, reason: 'empty' });
    expect(isSafePattern('a'.repeat(MAX_PATTERN_CHARS + 1))).toEqual({
      ok: false,
      reason: 'too_long',
    });
    expect(isSafePattern('([a-z')).toEqual({ ok: false, reason: 'invalid_syntax' });
  });

  it('refuses excessive group nesting', () => {
    expect(isSafePattern('((((((abc))))))').ok).toBe(false);
  });

  it('ACCEPTS ordinary search patterns — the gate must not be a wall', () => {
    for (const p of [
      '^use[A-Z]',
      'Service$',
      '\\.then\\(',
      '^import type ',
      'TODO|FIXME',
      'function\\s+\\w+',
      '\\bconsole\\.log\\b',
    ]) {
      expect(isSafePattern(p)).toEqual({ ok: true });
      expect(compileSafeRegex(p)).toBeInstanceOf(RegExp);
    }
  });

  it('never throws, and never hands back a global regex', () => {
    for (const p of ['([a-z', '(a+)+$', '', '\\', 'a{1,}']) {
      expect(() => compileSafeRegex(p)).not.toThrow();
      expect(compileSafeRegex(p)).toBeNull();
    }
    // A shared compiled regex with a sticky `lastIndex` silently skips matches.
    expect(compileSafeRegex('^use[A-Z]')!.global).toBe(false);
  });

  it('leaves `.*` alone by DEFAULT — genericness is a caller policy, not a safety rule', () => {
    // A conformance count wants it refused; a user's code search does not.
    expect(isSafePattern('.*')).toEqual({ ok: true });
    expect(isSafePattern('.*', { minLiteralChars: 3 })).toEqual({
      ok: false,
      reason: 'too_generic',
    });
  });

  it('honours a tightened maxChars but never a loosened one', () => {
    expect(isSafePattern('abcdef', { maxChars: 3 })).toEqual({ ok: false, reason: 'too_long' });
    expect(
      isSafePattern('a'.repeat(MAX_PATTERN_CHARS + 1), { maxChars: 10_000 }),
    ).toEqual({ ok: false, reason: 'too_long' });
  });
});

describe('literalContentLength', () => {
  it('counts real text, not metacharacters or classes', () => {
    expect(literalContentLength('.*')).toBe(0);
    expect(literalContentLength('\\s*\\w+')).toBe(0);
    expect(literalContentLength('[a-z]+')).toBe(0);
    expect(literalContentLength('await')).toBe(5);
    // `\.` is a literal dot; `\w` is not literal text.
    expect(literalContentLength('db\\.users')).toBe(8);
  });
});

describe('buildRgArgs — the flag-injection fix', () => {
  const args = buildRgArgs('-x', '/clone/root');

  it('passes the pattern behind -e so a leading dash cannot become a flag', () => {
    // The bug: positionally, `--pre=<COMMAND>` would be parsed as an OPTION, and
    // ripgrep runs that command per searched file.
    const i = args.indexOf('-e');
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe('-x');
  });

  it('terminates options with `--` before the search root', () => {
    const dashDash = args.indexOf('--');
    expect(dashDash).toBeGreaterThan(-1);
    expect(args[dashDash + 1]).toBe('/clone/root');
    expect(args[args.length - 1]).toBe('/clone/root');
  });

  it('puts the pattern AFTER every flag it must not be confused with', () => {
    expect(args.indexOf('-e')).toBeGreaterThan(args.indexOf('--color=never'));
  });

  it('caps per-file matches and file size so a broad pattern cannot balloon', () => {
    expect(args.some((a) => a.startsWith('--max-count='))).toBe(true);
    expect(args.some((a) => a.startsWith('--max-filesize='))).toBe(true);
  });

  it('never emits the pattern as a bare positional argument', () => {
    // The exact regression: `[...flags, pattern, root]`.
    const a = buildRgArgs('--pre=/bin/sh', '/clone/root');
    expect(a[a.indexOf('--pre=/bin/sh') - 1]).toBe('-e');
  });
});

describe('RipgrepCodeIndex.grep — whichever engine resolves', () => {
  // Points at real files on disk, so this runs against the ripgrep binary when
  // `@vscode/ripgrep` resolves and against the pure-Node fallback otherwise —
  // which is the point: the two must be indistinguishable to a caller.
  const root = join(import.meta.dirname, '..', 'src', 'platform');
  const idx = new RipgrepCodeIndex({ clonePathFor: () => root });
  const repo = { owner: 'acme', name: 'payments-api' };

  it('finds a real match and reports a repo-relative path', async () => {
    const hits = await idx.grep(repo, 'MAX_PATTERN_QUANTIFIERS');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toContain('pattern-safety');
    expect(hits[0]!.line).toBeGreaterThan(0);
  });

  it('returns [] for an unusable pattern instead of throwing', async () => {
    // Previously: the Node fallback threw a SyntaxError out of the adapter while
    // ripgrep silently resolved [] — so behaviour depended on an optional dep.
    await expect(idx.grep(repo, '([a-z')).resolves.toEqual([]);
    await expect(idx.grep(repo, '(a+)+$')).resolves.toEqual([]);
  });

  it('treats a dash-leading pattern as TEXT, not as a ripgrep flag', async () => {
    // The decisive case. `--color=never` literally appears in ripgrep.ts, so a
    // correct run FINDS it. Passed positionally (the bug), ripgrep would consume
    // it as an option instead and this returns nothing — which is also how
    // `--pre=<COMMAND>` used to become reachable.
    const adapters = join(import.meta.dirname, '..', 'src', 'adapters', 'codeindex');
    const search = new RipgrepCodeIndex({ clonePathFor: () => adapters });
    const hits = await search.grep(repo, '--color=never');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toContain('ripgrep');
  });

  it('does not execute a --pre payload, and does not error on it', async () => {
    await expect(idx.grep(repo, '--pre=echo')).resolves.toEqual([]);
  });

  it('finds matches in CRLF files and does not leak the CR into `text`', async () => {
    // Regression. The output parser split on '\n', leaving a trailing '\r' on
    // every line of a CRLF file — and `.` in a JS regex does not match '\r'
    // (it is a line terminator), so `^(.*?):(\d+):(.*)$` failed for ALL of them.
    // The adapter silently returned zero results for CRLF-checked-out repos, and
    // the pure-Node fallback additionally returned `text` with a stray CR.
    const dir = await mkdtemp(join(tmpdir(), 'rg-crlf-'));
    try {
      await writeFile(join(dir, 'crlf.ts'), 'const a = 1;\r\nexport const NEEDLE = 2;\r\n');
      const hits = await new RipgrepCodeIndex({ clonePathFor: () => dir }).grep(repo, 'NEEDLE');
      expect(hits).toHaveLength(1);
      expect(hits[0]!.line).toBe(2);
      expect(hits[0]!.text).toBe('export const NEEDLE = 2;');
      expect(hits[0]!.text).not.toContain('\r');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('MockCodeIndex.grep matches the real adapter contract', () => {
  it('returns [] for a pattern the safety dialect refuses', async () => {
    // A mock that accepted everything would show a hit in every test for a
    // pattern that returns nothing in production.
    const idx = new MockCodeIndex();
    const repo = { owner: 'acme', name: 'payments-api' };
    expect(await idx.grep(repo, '(a+)+$')).toEqual([]);
    expect(await idx.grep(repo, '')).toEqual([]);
    expect(await idx.grep(repo, 'rateLimit')).toHaveLength(1);
  });
});
