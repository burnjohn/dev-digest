/**
 * The one trust gate for a regex we did not write.
 *
 * Patterns reach us from two directions — a model proposing a convention probe,
 * and repo content flowing into a search — and Node cannot time out a regex once
 * it starts. Safety therefore comes from restricting the accepted DIALECT until
 * catastrophic backtracking is not constructible, not from interrupting a match
 * that already is.
 *
 * Lives in `platform/` rather than in the module that first needed it because the
 * `CodeIndex` adapter needs the same gate, and `adapters/` cannot import from
 * `modules/`. Duplicating a security validator is how the two copies drift.
 *
 * The accepted dialect is deliberately a SUBSET of both JS `RegExp` and Rust's
 * `regex` crate (no lookaround, no backreferences), so a pattern that passes here
 * can be handed to ripgrep and to `new RegExp` and mean the same thing.
 */

/** Default ceiling on pattern length. Callers may tighten it, never loosen it. */
export const MAX_PATTERN_CHARS = 1_000;
export const MAX_PATTERN_QUANTIFIERS = 10;
export const MAX_PATTERN_GROUP_DEPTH = 5;
export const MAX_PATTERN_REPEAT = 100;

export type PatternRejection =
  | 'empty'
  | 'too_long'
  | 'invalid_syntax'
  | 'nested_quantifier'
  | 'unbounded_repetition'
  | 'lookaround'
  | 'backreference'
  | 'too_deep'
  | 'too_many_quantifiers'
  | 'too_generic';

export type SafePatternResult = { ok: true } | { ok: false; reason: PatternRejection };

export interface PatternLimits {
  /** Tighter than `MAX_PATTERN_CHARS` when a caller wants short probes. */
  maxChars?: number;
  /**
   * Least metachar-stripped length the pattern must reach. A *correctness* knob,
   * not a safety one: `.*` is cheap to run but matches everything, so a caller
   * counting conformance wants it refused while a caller running a user's search
   * does not. Default 0 = allow.
   */
  minLiteralChars?: number;
}

/**
 * How much real text a pattern pins down, ignoring metacharacters.
 *
 * `\.` is one literal character; `\w` is a class and pins down nothing. A
 * character class counts as zero for the same reason — it matches one character
 * but names no specific text.
 */
export function literalContentLength(pattern: string): number {
  let n = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next !== undefined && !/[a-zA-Z0-9]/.test(next)) n += 1;
      i += 1;
      continue;
    }
    if (ch === '[') {
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (!'.*+?()|^$={}'.includes(ch)) n += 1;
  }
  return n;
}

/**
 * Is this pattern safe to run against untrusted-sized input? Pure, never throws.
 *
 * The rules, in order of what they defend against:
 *  - length, group depth and quantifier count bound the pattern's own size;
 *  - a quantifier applied to a group that already contains one (or an ambiguous
 *    alternation) is star-height >= 2 — `(a+)+`, `(a|a)*`, `(.*)*`, `(\s*\w+)+` —
 *    which is the entire constructible ReDoS family;
 *  - unbounded `{n,}` and huge `{n,m}` are the same explosion by another spelling;
 *  - lookaround and backreferences are the other backtracking amplifier, and are
 *    what keeps the dialect portable to ripgrep;
 *  - compilation is attempted last, inside try/catch, so a `SyntaxError` can never
 *    escape into a caller mid-scan.
 */
export function isSafePattern(pattern: string, limits: PatternLimits = {}): SafePatternResult {
  const maxChars = Math.min(limits.maxChars ?? MAX_PATTERN_CHARS, MAX_PATTERN_CHARS);
  if (!pattern) return { ok: false, reason: 'empty' };
  if (pattern.length > maxChars) return { ok: false, reason: 'too_long' };
  if (/\(\?<?[=!]/.test(pattern)) return { ok: false, reason: 'lookaround' };
  if (/\\[1-9]|\\k</.test(pattern)) return { ok: false, reason: 'backreference' };

  for (const m of pattern.matchAll(/\{(\d+)(,(\d*))?\}/g)) {
    const hasComma = m[2] !== undefined;
    const upper = m[3];
    if (hasComma && (upper === undefined || upper === '')) {
      return { ok: false, reason: 'unbounded_repetition' };
    }
    const bound = Number(upper ?? m[1]);
    if (Number.isFinite(bound) && bound > MAX_PATTERN_REPEAT) {
      return { ok: false, reason: 'unbounded_repetition' };
    }
  }

  // One pass, tracking group bodies so a quantified group can be inspected for
  // the quantifiers or ambiguous alternation that make it star-height 2.
  const stack: { start: number }[] = [];
  let quantifiers = 0;
  let maxDepth = 0;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      i += 1;
      continue;
    }
    if (ch === '[') {
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '(') {
      stack.push({ start: i });
      maxDepth = Math.max(maxDepth, stack.length);
      if (maxDepth > MAX_PATTERN_GROUP_DEPTH) return { ok: false, reason: 'too_deep' };
      continue;
    }
    if (ch === ')') {
      const open = stack.pop();
      const next = pattern[i + 1];
      if (open && next !== undefined && '*+?{'.includes(next)) {
        const body = pattern.slice(open.start + 1, i);
        if (/[*+{]/.test(body) || body.includes('|')) {
          return { ok: false, reason: 'nested_quantifier' };
        }
      }
      continue;
    }
    if (ch === '*' || ch === '+') quantifiers += 1;
  }
  if (quantifiers > MAX_PATTERN_QUANTIFIERS) {
    return { ok: false, reason: 'too_many_quantifiers' };
  }

  const minLiteral = limits.minLiteralChars ?? 0;
  if (minLiteral > 0 && literalContentLength(pattern) < minLiteral) {
    return { ok: false, reason: 'too_generic' };
  }

  try {
    new RegExp(pattern);
  } catch {
    return { ok: false, reason: 'invalid_syntax' };
  }
  return { ok: true };
}

/**
 * `isSafePattern` then compile. `null` for anything rejected — callers must treat
 * that as "this pattern is unusable", never as "this pattern matched nothing".
 *
 * Never returns a `/g` regex: a compiled pattern is typically reused across every
 * file of a corpus, and a sticky `lastIndex` silently skips matches. That is a
 * wrong-answer bug, not a hypothetical.
 */
export function compileSafeRegex(pattern: string, limits: PatternLimits = {}): RegExp | null {
  if (!isSafePattern(pattern, limits).ok) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
