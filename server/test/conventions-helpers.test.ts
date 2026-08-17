import { describe, it, expect } from 'vitest';
import {
  applyDedupVerdict,
  compileSafeRegex,
  composeSkillBody,
  countPathConformance,
  countSupport,
  findDuplicateIndex,
  countSymbolConformance,
  countTextConformance,
  distinctDirs,
  formatEvidenceRef,
  groundCandidate,
  groundConfigEvidence,
  hasIndependentSupport,
  isDuplicate,
  isSafePattern,
  mapWithConcurrency,
  normalizeSnippet,
  scoreConfidence,
  similarity,
  slugifyRule,
} from '../src/modules/conventions/helpers.js';
import {
  DEDUP_SIMILARITY,
  EVIDENCE_LINE_WINDOW,
  INCOMPLETE_SIGNAL_CAP,
  MAX_PROBE_CHARS,
} from '../src/modules/conventions/constants.js';

/**
 * The conventions extractor's trust boundary, hermetically.
 *
 * Everything here answers one question: what does the pipeline believe when the
 * model is wrong? The model supplies a line number, a quote, a confidence and a
 * claim of novelty — these helpers re-derive all four, so this file is where the
 * feature is actually pinned down.
 */

const FILE = [
  'import { db } from "../lib/db";', // 1
  '', // 2
  'export async function getUser(id: string) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  const posts = await db.posts.findMany({ userId: id });', // 5
  '  return { user, posts };', // 6
  '}', // 7
].join('\n');

describe('normalizeSnippet', () => {
  it('collapses the three things a model gets wrong when quoting code', () => {
    // indentation/wrapping, quote style, and a trailing separator
    expect(normalizeSnippet("   const a = 'x';  ")).toBe('const a = "x"');
    expect(normalizeSnippet('const a = `x`,')).toBe('const a = "x"');
    expect(normalizeSnippet('const a =\n    "x"')).toBe('const a = "x"');
  });

  it('is idempotent', () => {
    const once = normalizeSnippet("  foo('bar');  ");
    expect(normalizeSnippet(once)).toBe(once);
  });
});

describe('groundCandidate', () => {
  it('returns the real line range for an exact quote', () => {
    expect(
      groundCandidate(
        { evidence_snippet: '  const user = await db.users.find(id);', evidence_line: 4 },
        FILE,
      ),
    ).toEqual({ start_line: 4, end_line: 4 });
  });

  it('CORRECTS an off-by-N claimed line to where the snippet really is', () => {
    // The model quoted line 4 correctly but labelled it 7. The stored evidence is
    // the location we found, never the one it claimed.
    expect(
      groundCandidate(
        { evidence_snippet: 'const user = await db.users.find(id);', evidence_line: 7 },
        FILE,
      ),
    ).toEqual({ start_line: 4, end_line: 4 });
  });

  it('grounds a multi-line quote to its full span', () => {
    expect(
      groundCandidate(
        {
          evidence_snippet:
            'const user = await db.users.find(id);\nconst posts = await db.posts.findMany({ userId: id });',
          evidence_line: 4,
        },
        FILE,
      ),
    ).toEqual({ start_line: 4, end_line: 5 });
  });

  it('matches through reformatted quotes (quote style + whitespace)', () => {
    expect(
      groundCandidate({ evidence_snippet: "import { db } from '../lib/db'", evidence_line: 1 }, FILE),
    ).toEqual({ start_line: 1, end_line: 1 });
  });

  it('DROPS a snippet that is not in the file at all', () => {
    expect(
      groundCandidate({ evidence_snippet: 'db.users.findOrFail(id)', evidence_line: 4 }, FILE),
    ).toBeNull();
  });

  it('DROPS a real snippet claimed far outside the line window', () => {
    const padded = ['x'.repeat(3), ...Array(EVIDENCE_LINE_WINDOW + 10).fill('// filler'), 'const z = 1;'].join('\n');
    // `const z = 1;` really is in the file, but nowhere near line 2 — a quote
    // that grounds itself hundreds of lines from its claim is not evidence.
    expect(groundCandidate({ evidence_snippet: 'const z = 1;', evidence_line: 2 }, padded)).toBeNull();
    // With no claimed line there is no window to violate, so it grounds.
    expect(groundCandidate({ evidence_snippet: 'const z = 1;', evidence_line: null }, padded))
      .toEqual({ start_line: EVIDENCE_LINE_WINDOW + 12, end_line: EVIDENCE_LINE_WINDOW + 12 });
  });

  it('DROPS an empty snippet rather than grounding it at line 1', () => {
    expect(groundCandidate({ evidence_snippet: '   ', evidence_line: 1 }, FILE)).toBeNull();
  });

  it('picks the occurrence nearest the claim when a line repeats', () => {
    const repeated = ['return null;', '// a', '// b', 'return null;'].join('\n');
    expect(groundCandidate({ evidence_snippet: 'return null;', evidence_line: 4 }, repeated))
      .toEqual({ start_line: 4, end_line: 4 });
    expect(groundCandidate({ evidence_snippet: 'return null;', evidence_line: 1 }, repeated))
      .toEqual({ start_line: 1, end_line: 1 });
  });
});

describe('countSupport', () => {
  const files = [
    { path: 'a.ts', text: 'const x = await db.users.find(1);' },
    { path: 'b.ts', text: "const y = await db.users.find('2')" },
    { path: 'c.ts', text: 'db.users.findMany()' },
  ];

  it('counts files containing the normalized probe and names them', () => {
    expect(countSupport(normalizeSnippet('await db.users.find('), files)).toEqual({
      count: 2,
      files: ['a.ts', 'b.ts'],
    });
  });

  it('is zero for an empty probe — never "every file matches"', () => {
    expect(countSupport('', files)).toEqual({ count: 0, files: [] });
  });
});

describe('isSafePattern / compileSafeRegex', () => {
  it('refuses the constructible ReDoS family', () => {
    // Star-height >= 2 and quantified ambiguous alternation — the shapes that turn
    // a 400-char line into minutes of backtracking.
    for (const p of ['(a+)+$', '(a|a)*b', '(.*)*x', '(\\s*\\w+)+b']) {
      expect(isSafePattern(p)).toEqual({ ok: false, reason: 'nested_quantifier' });
    }
  });

  it('refuses unbounded and oversized repetition', () => {
    expect(isSafePattern('abc{1,}')).toEqual({ ok: false, reason: 'unbounded_repetition' });
    expect(isSafePattern('abc{500}')).toEqual({ ok: false, reason: 'unbounded_repetition' });
  });

  it('refuses lookaround and backreferences — the other amplifier', () => {
    // Also keeps the accepted dialect a subset of Rust's `regex`, so a future
    // ripgrep-backed count would not need a second escaping story.
    expect(isSafePattern('foo(?=bar)')).toEqual({ ok: false, reason: 'lookaround' });
    expect(isSafePattern('(?<!bar)foo')).toEqual({ ok: false, reason: 'lookaround' });
    expect(isSafePattern('(abc)\\1')).toEqual({ ok: false, reason: 'backreference' });
  });

  it('refuses a pattern that pins down nothing', () => {
    // A correctness guard as much as a safety one: `.*` is cheap to run and would
    // report that 100% of the repo conforms to whatever rule it was attached to.
    for (const p of ['.*', '.+', '\\s*', '^']) {
      expect(isSafePattern(p).ok).toBe(false);
    }
  });

  it('refuses an over-long pattern', () => {
    expect(isSafePattern('a'.repeat(MAX_PROBE_CHARS + 1))).toEqual({
      ok: false,
      reason: 'too_long',
    });
  });

  it('ACCEPTS the patterns a real probe is made of', () => {
    for (const p of ['^use[A-Z]', 'Service$', '\\.then\\(', '^import type ', 'await db\\.users']) {
      expect(isSafePattern(p)).toEqual({ ok: true });
      expect(compileSafeRegex(p)).toBeInstanceOf(RegExp);
    }
  });

  it('never throws on a rejected or malformed pattern — it returns null', () => {
    // A SyntaxError escaping mid-scan would fail the whole category call.
    for (const p of ['([a-z', '(a+)+$', '', '\\']) {
      expect(() => compileSafeRegex(p)).not.toThrow();
      expect(compileSafeRegex(p)).toBeNull();
    }
  });

  it('never returns a global regex', () => {
    // One compiled probe is reused across every file of the corpus; a sticky
    // `lastIndex` would silently skip matches.
    expect(compileSafeRegex('^use[A-Z]')!.global).toBe(false);
  });
});

describe('conformance counting', () => {
  const FILES = [
    { path: 'src/a.ts', text: 'const u = await db.users.find(id);' },
    { path: 'src/api/b.ts', text: 'const v = await db.users.find(2);' },
    { path: 'src/legacy/c.ts', text: 'db.users.findAll().then((r) => r);' },
  ];

  it('counts FILES, not occurrences, so one dense file cannot outweigh the repo', () => {
    const r = countTextConformance({ kind: 'literal', pattern: 'await db.users.find(' }, [
      ...FILES,
      { path: 'src/d.ts', text: 'await db.users.find(1); await db.users.find(2);' },
    ]);
    expect(r.followCount).toBe(3);
    expect(r.files).toEqual(['src/a.ts', 'src/api/b.ts', 'src/d.ts']);
  });

  it('reports an unmeasurable denominator as null, not as zero violations', () => {
    expect(
      countTextConformance({ kind: 'regex', pattern: 'await db\\.users' }, FILES).violateCount,
    ).toBeNull();

    const withCounter = countTextConformance(
      {
        kind: 'regex',
        pattern: 'await db\\.users',
        counterKind: 'regex',
        counterPattern: '\\.then\\(',
      },
      FILES,
    );
    expect(withCounter.followCount).toBe(2);
    expect(withCounter.violateCount).toBe(1);
  });

  it('stops at the site budget and says how far it got', () => {
    const r = countTextConformance({ kind: 'literal', pattern: 'await db.users.find(' }, FILES, 2);
    expect(r.examined).toBe(2);
    expect(r.corpusSize).toBe(3);
  });

  it('scopes a symbol count to the declarations the rule governs', () => {
    const symbols = [
      { path: 'src/hooks/a.ts', name: 'useUser', kind: 'function', exported: true },
      { path: 'src/hooks/b.ts', name: 'useCart', kind: 'function', exported: true },
      { path: 'src/hooks/c.ts', name: 'getData', kind: 'function', exported: true },
      { path: 'src/hooks/d.ts', name: 'useLocal', kind: 'function', exported: false },
      { path: 'src/types.ts', name: 'UserRow', kind: 'interface', exported: true },
    ];
    const r = countSymbolConformance('^use[A-Z]', { kinds: ['function'], exported: true }, symbols);
    // The interface and the unexported function are out of scope entirely — they
    // are not violations, they are simply not governed by the rule.
    expect(r.followCount).toBe(2);
    expect(r.violateCount).toBe(1);
    expect(r.files).toEqual(['src/hooks/a.ts', 'src/hooks/b.ts']);
  });

  it('treats an EMPTY symbol scope as unmeasurable, never as the whole repo', () => {
    // Scoring "hooks are named use*" against every symbol in the codebase would
    // report ~2% conformance for a rule that is universally followed.
    const symbols = [
      { path: 'a.ts', name: 'useUser', kind: 'function', exported: true },
      { path: 'b.ts', name: 'somethingElse', kind: 'class', exported: false },
    ];
    expect(countSymbolConformance('^use[A-Z]', {}, symbols).violateCount).toBeNull();
  });

  it('treats a path count with no `applies_to` as unmeasurable', () => {
    const paths = ['src/modules/a/service.ts', 'src/modules/b/service.ts', 'src/util.ts'];
    expect(countPathConformance('/service\\.ts$', null, paths).violateCount).toBeNull();
    const scoped = countPathConformance('/service\\.ts$', '^src/modules/', paths);
    expect(scoped.followCount).toBe(2);
    expect(scoped.violateCount).toBe(0);
  });
});

describe('hasIndependentSupport / distinctDirs', () => {
  it('is false when the only supporter is the file the rule was quoted from', () => {
    expect(hasIndependentSupport(['src/a.ts'], 'src/a.ts')).toBe(false);
    expect(hasIndependentSupport([], 'src/a.ts')).toBe(false);
    expect(hasIndependentSupport(['src/a.ts', 'src/b.ts'], 'src/a.ts')).toBe(true);
  });

  it('counts parent directories, with root-level files in one bucket', () => {
    expect(distinctDirs(['a.ts', 'b.ts'])).toBe(1);
    expect(distinctDirs(['src/api/a.ts', 'src/api/b.ts', 'src/lib/c.ts'])).toBe(2);
  });
});

describe('scoreConfidence', () => {
  /** The motivating case: a naming rule measured over declarations. */
  const STRONG_NAMING = {
    followCount: 30,
    violateCount: 2,
    supportFiles: [
      'src/a/1.ts',
      'src/b/2.ts',
      'src/c/3.ts',
      'src/d/4.ts',
      'src/e/5.ts',
      'src/f/6.ts',
    ],
    strategy: 'symbols' as const,
    corpusSize: 32,
    configDeclared: false,
    modelConfidence: 0.8,
  };

  it('scores the case that motivated this rework FAR above the old 0.30 floor', () => {
    // Under the previous scorer this exact rule landed at ~0.30: its literal probe
    // matched only the file it was copied from, so support collapsed to 1 and the
    // low-support penalty was applied on top of an already-collapsed support term.
    expect(scoreConfidence(STRONG_NAMING).confidence).toBeGreaterThan(0.8);
  });

  it('ranks conformance above raw count', () => {
    const many = scoreConfidence({ ...STRONG_NAMING, followCount: 6, violateCount: 30 });
    const few = scoreConfidence({ ...STRONG_NAMING, followCount: 4, violateCount: 0 });
    expect(few.confidence).toBeGreaterThan(many.confidence);
  });

  it('redistributes weight when conformance is unmeasurable, then CAPS the result', () => {
    const capped = scoreConfidence({ ...STRONG_NAMING, violateCount: null });
    expect(capped.conformance).toBeNull();
    // Not halved — we do not punish a rule for our own inability to measure it.
    expect(capped.confidence).toBeGreaterThan(0.5);
    // But it must not read as near-certainty either.
    expect(capped.confidence).toBeLessThanOrEqual(INCOMPLETE_SIGNAL_CAP);
    expect(capped.capped).toBe(true);
  });

  it('only reports `capped` when there was no denominator', () => {
    expect(scoreConfidence(STRONG_NAMING).capped).toBe(false);
  });

  it('adds the config boost and still clamps at 1', () => {
    const plain = scoreConfidence(STRONG_NAMING);
    const declared = scoreConfidence({ ...STRONG_NAMING, configDeclared: true });
    expect(declared.confidence).toBeGreaterThan(plain.confidence);
    expect(
      scoreConfidence({
        ...STRONG_NAMING,
        violateCount: 0,
        modelConfidence: 1,
        configDeclared: true,
      }).confidence,
    ).toBeLessThanOrEqual(1);
  });

  it('rewards a rule spread across the tree over one confined to a folder', () => {
    const narrow = scoreConfidence({
      ...STRONG_NAMING,
      supportFiles: ['src/a/1.ts', 'src/a/2.ts', 'src/a/3.ts'],
    });
    expect(scoreConfidence(STRONG_NAMING).confidence).toBeGreaterThan(narrow.confidence);
  });

  it('scales the support target to what was actually counted', () => {
    // 2 of 2 is full corroboration; asking for 8 supporters out of a 2-file corpus
    // would punish a rule for the corpus's size.
    expect(
      scoreConfidence({
        followCount: 2,
        violateCount: 0,
        supportFiles: ['a/1.ts', 'b/2.ts'],
        strategy: 'text',
        corpusSize: 2,
        configDeclared: false,
        modelConfidence: 1,
      }).support,
    ).toBe(1);
  });

  it('clamps a nonsense model score instead of propagating it', () => {
    const at = (modelConfidence: number) =>
      scoreConfidence({ ...STRONG_NAMING, modelConfidence }).confidence;
    expect(at(Number.NaN)).toBe(at(0.5));
    expect(at(9)).toBe(at(1));
    expect(at(-3)).toBe(at(0));
  });

  it('is deterministic and always a 2dp value in [0,1]', () => {
    const a = scoreConfidence(STRONG_NAMING);
    expect(a).toEqual(scoreConfidence(STRONG_NAMING));
    expect(a.confidence).toBeGreaterThanOrEqual(0);
    expect(a.confidence).toBeLessThanOrEqual(1);
    expect(Math.round(a.confidence * 100)).toBe(a.confidence * 100);
  });
});

describe('groundConfigEvidence', () => {
  const CONFIGS = [
    { path: 'tsconfig.json', text: '{ "compilerOptions": { "strict": true } }' },
    { path: '.prettierrc', text: '{ "singleQuote": true }' },
  ];

  it('believes a fragment that is really in the config it cites', () => {
    expect(groundConfigEvidence({ path: 'tsconfig.json', snippet: '"strict": true' }, CONFIGS)).toBe(
      true,
    );
  });

  it('refuses a fabricated quote, and a real quote attributed to the wrong file', () => {
    expect(
      groundConfigEvidence({ path: 'tsconfig.json', snippet: '"skipAuth": true' }, CONFIGS),
    ).toBe(false);
    expect(
      groundConfigEvidence({ path: 'tsconfig.json', snippet: '"singleQuote": true' }, CONFIGS),
    ).toBe(false);
  });

  it('refuses a config we never read, and a missing claim', () => {
    expect(groundConfigEvidence({ path: 'eslint.config.js', snippet: 'no-floating' }, CONFIGS)).toBe(
      false,
    );
    expect(groundConfigEvidence(null, CONFIGS)).toBe(false);
  });
});

describe('similarity / isDuplicate', () => {
  it('scores a rule restated inside a long skill body as covered', () => {
    const rule = 'Always use async/await instead of .then() chains';
    const body =
      '# async-style\nThis project is written with async/await everywhere. Never write ' +
      'a .then() chain in application code; the linter does not catch it, so reviewers must.';
    expect(similarity(rule, body)).toBeGreaterThanOrEqual(DEDUP_SIMILARITY);
    expect(isDuplicate(rule, [body])).toBe(true);
  });

  it('keeps two genuinely different rules apart', () => {
    expect(
      similarity(
        'Always use async/await instead of .then() chains',
        'Redis access goes through the src/lib/redis.ts singleton',
      ),
    ).toBeLessThan(DEDUP_SIMILARITY);
  });

  it('is 0 against nothing — an empty existing set never dedups', () => {
    expect(similarity('some rule', '')).toBe(0);
    expect(isDuplicate('some rule', [])).toBe(false);
  });

  it('findDuplicateIndex reports WHICH rule matched, so a merge can re-score it', () => {
    const existing = [
      'Redis access goes through the src/lib/redis.ts singleton',
      'Always use async/await instead of .then() chains',
    ];
    expect(findDuplicateIndex('Always use async/await instead of .then() chains', existing)).toBe(1);
    expect(findDuplicateIndex('Components live under _components', existing)).toBeNull();
    expect(findDuplicateIndex('anything', [])).toBeNull();
  });

  it('cannot see a paraphrase — this is why step H2 exists', () => {
    // The pair that shipped side by side on the Conventions page. Same rule, two
    // vocabularies: 0.60 containment against a 0.80 threshold. Lowering the
    // threshold is not the fix (see DEDUP_SIMILARITY), so this stays a miss here
    // and is caught semantically instead.
    const a = 'All asynchronous functions use await for handling promises instead of .then() chaining.';
    const b = 'All asynchronous operations use await instead of promise chains.';
    expect(similarity(a, b)).toBeLessThan(DEDUP_SIMILARITY);
    expect(isDuplicate(a, [b])).toBe(false);
  });
});

describe('applyDedupVerdict', () => {
  /** Candidates shaped as the pipeline holds them at step H2. */
  const cand = (rule: string, confidence: number) => ({ rule, breakdown: { confidence } });
  const conf = (c: { breakdown: { confidence: number } }) => c.breakdown.confidence;
  const rules = (out: { rule: string }[]) => out.map((c) => c.rule);

  const THREE = [cand('a', 0.9), cand('b', 0.5), cand('c', 0.7)];

  it('keeps the highest-confidence member of a group and drops the rest', () => {
    const out = applyDedupVerdict(THREE, { duplicate_groups: [[0, 1, 2]] }, conf, 0);
    expect(rules(out)).toEqual(['a']);
  });

  it('is a no-op for an empty or absent verdict', () => {
    expect(rules(applyDedupVerdict(THREE, {}, conf, 0))).toEqual(['a', 'b', 'c']);
    expect(
      rules(applyDedupVerdict(THREE, { duplicate_groups: [], covered_by_existing: [] }, conf, 0)),
    ).toEqual(['a', 'b', 'c']);
  });

  it('ignores out-of-range, negative, and non-integer indices', () => {
    const verdict = {
      duplicate_groups: [[0, 99], [1, -1]],
      covered_by_existing: [7, 2.5 as number],
    };
    expect(rules(applyDedupVerdict(THREE, verdict, conf, 1))).toEqual(['a', 'b', 'c']);
  });

  it('never lets a group empty the list, even one naming every candidate twice', () => {
    const out = applyDedupVerdict(THREE, { duplicate_groups: [[0, 0, 1, 1, 2, 2]] }, conf, 0);
    expect(rules(out)).toEqual(['a']);
  });

  it('does not drop a lone candidate a repeated index inflates into a "group"', () => {
    const one = [cand('only', 0.4)];
    expect(rules(applyDedupVerdict(one, { duplicate_groups: [[0, 0]] }, conf, 0))).toEqual(['only']);
  });

  it('spends each index once — a second group cannot re-drop a survivor', () => {
    const out = applyDedupVerdict(THREE, { duplicate_groups: [[0, 1], [0, 2]] }, conf, 0);
    // 'a' won group 1; group 2 is then a single unspent member (2) and is skipped.
    expect(rules(out)).toEqual(['a', 'c']);
  });

  it('drops rules covered by the decided set', () => {
    const out = applyDedupVerdict(THREE, { covered_by_existing: [0, 2] }, conf, 4);
    expect(rules(out)).toEqual(['b']);
  });

  it('ignores covered_by_existing when there was nothing to be covered by', () => {
    // The model cannot truthfully say a rule restates one of zero decided rules.
    const out = applyDedupVerdict(THREE, { covered_by_existing: [0, 1, 2] }, conf, 0);
    expect(rules(out)).toEqual(['a', 'b', 'c']);
  });

  it('lets the decided set legitimately clear every candidate', () => {
    const out = applyDedupVerdict(THREE, { covered_by_existing: [0, 1, 2] }, conf, 3);
    expect(out).toEqual([]);
  });
});

describe('slugifyRule / formatEvidenceRef', () => {
  it('heads a section with the rule\'s subject, not its grammar', () => {
    expect(slugifyRule('Always use async/await instead of .then() chains', 'x')).toBe(
      'async-await-then-chains',
    );
  });

  it('falls back when a rule has no content words', () => {
    expect(slugifyRule('the a of', 'rule-3')).toBe('rule-3');
  });

  it('renders a single-line range without a redundant end', () => {
    const base = { rule: 'r', evidence_path: 'a.ts', evidence_snippet: 's' };
    expect(formatEvidenceRef({ ...base, evidence_start_line: 5, evidence_end_line: 5 })).toBe('a.ts:5');
    expect(formatEvidenceRef({ ...base, evidence_start_line: 5, evidence_end_line: 9 })).toBe('a.ts:5-9');
    expect(formatEvidenceRef({ ...base, evidence_start_line: null, evidence_end_line: null })).toBe('a.ts');
  });
});

describe('composeSkillBody', () => {
  const accepted = [
    {
      rule: 'Always use async/await instead of .then() chains',
      evidence_path: 'src/api/users.ts',
      evidence_start_line: 23,
      evidence_end_line: 31,
      evidence_snippet: 'const user = await db.users.find(id);',
    },
    {
      rule: 'All public route handlers return typed Result<T, ApiError>',
      evidence_path: 'src/api/public/index.ts',
      evidence_start_line: 14,
      evidence_end_line: 20,
      evidence_snippet: 'function handler(): Result<Item[], ApiError> {',
    },
  ];

  it('merges every accepted rule into ONE body, each with its citation', () => {
    const body = composeSkillBody('payments-api', accepted);
    expect(body.startsWith('# payments-api-conventions')).toBe(true);
    expect(body).toContain('## async-await-then-chains');
    expect(body).toContain('Detected in `src/api/users.ts:23-31`:');
    expect(body).toContain('const user = await db.users.find(id);');
    // one section per rule, no more
    expect(body.match(/^## /gm)).toHaveLength(2);
  });

  it('disambiguates rules that slug to the same heading', () => {
    const body = composeSkillBody('r', [accepted[0]!, { ...accepted[0]!, evidence_path: 'b.ts' }]);
    expect(body).toContain('## async-await-then-chains');
    expect(body).toContain('## async-await-then-chains-2');
  });

  it('is still a valid skill body with nothing accepted', () => {
    const body = composeSkillBody('payments-api', []);
    expect(body.startsWith('# payments-api-conventions')).toBe(true);
    expect(body.match(/^## /gm)).toBeNull();
  });
});

describe('mapWithConcurrency', () => {
  it('preserves input order and respects the cap', () => {
    const order: number[] = [];
    let inFlight = 0;
    let peak = 0;
    return mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      order.push(n);
      inFlight -= 1;
      return n * 2;
    }).then((out) => {
      expect(out).toEqual([2, 4, 6, 8, 10, 12]);
      expect(peak).toBeLessThanOrEqual(2);
      expect(order).toHaveLength(6);
    });
  });

  it('handles an empty list without hanging', async () => {
    await expect(mapWithConcurrency([], 3, async (x) => x)).resolves.toEqual([]);
  });
});
