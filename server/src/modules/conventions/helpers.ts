import type { ProbeStrategy } from '@devdigest/shared';
import {
  compileSafeRegex as compileSafeRegexCore,
  isSafePattern as isSafePatternCore,
  type SafePatternResult,
} from '../../platform/pattern-safety.js';
export type { PatternRejection, SafePatternResult } from '../../platform/pattern-safety.js';
export { literalContentLength } from '../../platform/pattern-safety.js';
import {
  CONFIG_DECLARED_BOOST,
  DEDUP_SIMILARITY,
  EVIDENCE_LINE_WINDOW,
  EVIDENCE_SPAN_SLACK,
  INCOMPLETE_SIGNAL_CAP,
  MAX_PROBE_CHARS,
  MAX_PROBE_LINE_CHARS,
  MAX_PROBE_SITES,
  MIN_PROBE_LITERAL_CHARS,
  SKILL_NAME_SUFFIX,
  SLUG_MAX_WORDS,
  SPREAD_SATURATION_DIRS,
  SUPPORT_SATURATION,
  W_CONFORMANCE,
  W_MODEL,
  W_SPREAD,
  W_SUPPORT,
} from './constants.js';

/**
 * L02 — pure logic for the conventions extractor. Everything that decides whether
 * a proposed rule is believed lives here, with no db/llm/fs in sight, because
 * this is the part that must be provably right: the model's line numbers, its
 * confidence, and its uniqueness are all re-derived, never trusted.
 *
 * Mirrors the reviewer's grounding rule ("a finding without a real diff line is
 * dropped") one layer up: a convention without a real repo line is dropped.
 */

// ---------------------------------------------------------------- normalization

/**
 * Canonical form for comparing a quoted snippet to real source.
 *
 * Collapses the three things a model reliably gets wrong when quoting code while
 * meaning the same line: indentation/wrapping, quote style, and a trailing
 * separator it did or didn't include. Everything downstream — grounding, support
 * counting, dedup — compares normalized text only.
 */
export function normalizeSnippet(s: string): string {
  return s
    .replace(/[`'‘’“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[;,]+$/, '')
    .trim();
}

// -------------------------------------------------------------------- grounding

/** A candidate as the model returned it — only the fields grounding needs. */
export interface UngroundedEvidence {
  evidence_snippet: string;
  /** The line the model CLAIMED. Advisory: it picks between matches, it is never trusted as the answer. */
  evidence_line?: number | null;
}

/** Where the snippet really is, 1-indexed and inclusive. */
export interface GroundedEvidence {
  start_line: number;
  end_line: number;
}

/**
 * Locate a candidate's snippet in the file it cites, returning the REAL line
 * range or `null` to drop the candidate.
 *
 * Three things are going on:
 *  - **The claimed line is a hint, not evidence.** Models routinely cite a line
 *    a few off from the one they quoted. We search the file and correct it.
 *  - **A match must be near the claim.** A snippet found 300 lines away is not
 *    the line the model was looking at; treating that as a hit would let a
 *    generic quote (`}`) ground itself anywhere. Outside
 *    `EVIDENCE_LINE_WINDOW` → dropped. With no usable claimed line, the first
 *    (tightest) match wins.
 *  - **The window grows, so multi-line quotes survive reflow.** From each start
 *    line we extend up to the snippet's own line count plus
 *    `EVIDENCE_SPAN_SLACK` and take the smallest window that contains the probe.
 */
export function groundCandidate(
  candidate: UngroundedEvidence,
  fileText: string,
): GroundedEvidence | null {
  const probe = normalizeSnippet(candidate.evidence_snippet);
  if (!probe) return null;

  const lines = fileText.split(/\r?\n/);
  const snippetLines = candidate.evidence_snippet
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;
  const maxSpan = Math.max(1, snippetLines) + EVIDENCE_SPAN_SLACK;

  const hits: { start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const limit = Math.min(lines.length, i + maxSpan);
    for (let end = i + 1; end <= limit; end += 1) {
      if (normalizeSnippet(lines.slice(i, end).join('\n')).includes(probe)) {
        hits.push({ start: i, end });
        break;
      }
    }
  }
  if (hits.length === 0) return null;

  const claimed =
    typeof candidate.evidence_line === 'number' &&
    Number.isFinite(candidate.evidence_line) &&
    candidate.evidence_line > 0
      ? candidate.evidence_line
      : null;
  const distance = (h: { start: number }) =>
    claimed === null ? 0 : Math.abs(h.start + 1 - claimed);

  const inWindow =
    claimed === null ? hits : hits.filter((h) => distance(h) <= EVIDENCE_LINE_WINDOW);
  if (inWindow.length === 0) return null;

  // Nearest to the claim, then the tightest window, then earliest — a total
  // order, so grounding the same candidate twice cannot yield two answers.
  const best = [...inWindow].sort(
    (a, b) =>
      distance(a) - distance(b) ||
      (a.end - a.start) - (b.end - b.start) ||
      a.start - b.start,
  )[0]!;
  return { start_line: best.start + 1, end_line: best.end };
}

// --------------------------------------------------------------- support counts

/** A file read for support counting. */
export interface ScannedFile {
  path: string;
  text: string;
}

/**
 * How many of the scanned files contain the probe — the evidence that turns
 * "the model says this is a convention" into "this is done in N places".
 *
 * Takes an ALREADY-normalized probe so the caller normalizes once per candidate
 * instead of once per (candidate × file).
 */
export function countSupport(
  normalizedProbe: string,
  files: ScannedFile[],
): { count: number; files: string[] } {
  if (!normalizedProbe) return { count: 0, files: [] };
  const matched = files
    .filter((f) => normalizeSnippet(f.text).includes(normalizedProbe))
    .map((f) => f.path);
  return { count: matched.length, files: matched };
}

// ------------------------------------------------------- conformance counting

/**
 * What a probe pair actually measured.
 *
 * `violateCount === null` is the load-bearing case: it means no denominator could
 * be established, which is NOT the same as "no violations found". Every consumer
 * has to keep those apart or an unverifiable rule silently becomes a perfect one.
 */
export interface ConformanceCount {
  followCount: number;
  violateCount: number | null;
  /** Distinct repo files the FOLLOWING sites live in. */
  files: string[];
  /** Sites actually inspected — below `corpusSize` when the budget ran out. */
  examined: number;
  corpusSize: number;
}

export type PatternKind = 'literal' | 'regex';

export interface TextProbe {
  kind: PatternKind;
  pattern: string;
  /** What a VIOLATION looks like. Absent ⇒ conformance is unmeasurable. */
  counterKind?: PatternKind | null;
  counterPattern?: string | null;
}

/** Compile a probe slot into a predicate, or `null` when the pattern is unusable. */
function textMatcher(kind: PatternKind, pattern: string): ((text: string) => boolean) | null {
  if (kind === 'literal') {
    const probe = normalizeSnippet(pattern);
    if (!probe) return null;
    return (text) => normalizeSnippet(text).includes(probe);
  }
  const re = compileSafeRegex(pattern);
  if (!re) return null;
  // Line-wise, with each line capped: this is what bounds a single `re.test`
  // call's input, which is half of why the pattern envelope is enough without a
  // clock.
  return (text) =>
    text.split(/\r?\n/).some((line) => re.test(line.slice(0, MAX_PROBE_LINE_CHARS)));
}

/**
 * Conformance over source text. A site is a FILE — a rule either shows up in a
 * file or it does not, and counting occurrences would let one dense file
 * outweigh the rest of the repo.
 */
export function countTextConformance(
  probe: TextProbe,
  files: ScannedFile[],
  budget: number = MAX_PROBE_SITES,
): ConformanceCount {
  const follows = textMatcher(probe.kind, probe.pattern);
  const violates =
    probe.counterPattern && probe.counterKind
      ? textMatcher(probe.counterKind, probe.counterPattern)
      : null;

  const matched: string[] = [];
  let violateCount = 0;
  let examined = 0;
  for (const f of files) {
    if (examined >= budget) break;
    examined += 1;
    if (follows?.(f.text)) matched.push(f.path);
    else if (violates?.(f.text)) violateCount += 1;
  }
  return {
    followCount: matched.length,
    violateCount: violates ? violateCount : null,
    files: matched,
    examined,
    corpusSize: files.length,
  };
}

/** One indexed declaration, as the `symbols` strategy sees it. */
export interface SymbolSite {
  path: string;
  name: string;
  kind: string;
  exported: boolean;
}

/**
 * THE DENOMINATOR for a naming rule: which declarations the rule governs.
 *
 * At least one field must be set. An empty scope is treated as unmeasurable
 * rather than as "the whole repo" — scoring "hooks are named `use*`" against
 * every symbol in the codebase would report ~2% conformance for a rule that is
 * universally followed.
 */
export interface SymbolScope {
  kinds?: string[] | null;
  exported?: boolean | null;
  pathPattern?: string | null;
}

/**
 * Conformance over declarations. A site is a SYMBOL, so `followCount` here counts
 * declarations and can exceed the file count — 30 conforming hooks across 14
 * files is `followCount: 30`, `files.length: 14`.
 */
export function countSymbolConformance(
  pattern: string,
  scope: SymbolScope,
  symbols: SymbolSite[],
  budget: number = MAX_PROBE_SITES,
): ConformanceCount {
  const re = compileSafeRegex(pattern);
  const kinds = scope.kinds?.length ? new Set(scope.kinds) : null;
  const pathRe = scope.pathPattern ? compileSafeRegex(scope.pathPattern) : null;
  const scoped = kinds !== null || scope.exported != null || pathRe !== null;

  const matched: string[] = [];
  let followCount = 0;
  let violateCount = 0;
  let examined = 0;
  for (const sym of symbols) {
    if (examined >= budget) break;
    if (kinds && !kinds.has(sym.kind)) continue;
    if (scope.exported != null && sym.exported !== scope.exported) continue;
    if (pathRe && !pathRe.test(sym.path)) continue;
    examined += 1;
    if (re?.test(sym.name)) {
      followCount += 1;
      matched.push(sym.path);
    } else {
      violateCount += 1;
    }
  }
  return {
    followCount,
    violateCount: re && scoped ? violateCount : null,
    files: [...new Set(matched)],
    examined,
    corpusSize: symbols.length,
  };
}

/**
 * Conformance over file paths. A site is a PATH, and `appliesTo` is the
 * denominator — the same "declare your scope" rule as `SymbolScope`, for the same
 * reason.
 */
export function countPathConformance(
  pattern: string,
  appliesTo: string | null | undefined,
  paths: string[],
  budget: number = MAX_PROBE_SITES,
): ConformanceCount {
  const re = compileSafeRegex(pattern);
  const scopeRe = appliesTo ? compileSafeRegex(appliesTo) : null;

  const matched: string[] = [];
  let violateCount = 0;
  let examined = 0;
  for (const path of paths) {
    if (examined >= budget) break;
    if (scopeRe && !scopeRe.test(path)) continue;
    examined += 1;
    if (re?.test(path)) matched.push(path);
    else violateCount += 1;
  }
  return {
    followCount: matched.length,
    violateCount: re && scopeRe ? violateCount : null,
    files: matched,
    examined,
    corpusSize: paths.length,
  };
}

// ------------------------------------------------------------- pattern safety

/**
 * A probe's pattern limits: the shared safety dialect, tightened for probes.
 *
 * `minLiteralChars` is the conventions-specific half — a probe that is nearly all
 * metacharacters is a CORRECTNESS problem here, not a safety one, because `.*`
 * runs fine and would report that 100% of the repo conforms to whatever rule it
 * was attached to. A general code search has no such objection, which is why the
 * rule lives here rather than in `platform/pattern-safety`.
 */
const PROBE_LIMITS = {
  maxChars: MAX_PROBE_CHARS,
  minLiteralChars: MIN_PROBE_LITERAL_CHARS,
} as const;

/** The trust gate for a model-authored probe. See `platform/pattern-safety`. */
export function isSafePattern(pattern: string): SafePatternResult {
  return isSafePatternCore(pattern, PROBE_LIMITS);
}

/** `isSafePattern` then compile; `null` = unusable probe, NOT "matched nothing". */
export function compileSafeRegex(pattern: string): RegExp | null {
  return compileSafeRegexCore(pattern, PROBE_LIMITS);
}

// ------------------------------------------------------------------- scoring

/** Parent directory of a path; `''` for a root-level file. No `node:path` here. */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** How many distinct directories a rule's supporting files span. */
export function distinctDirs(paths: string[]): number {
  return new Set(paths.map(dirOf)).size;
}

/**
 * The drop gate: does anything OTHER than the file we quoted follow this rule?
 *
 * A rule supported only by its own citation is a statement about one file. The
 * old pipeline showed those at a demoted score, which is how the page filled up
 * with "1 file follows this" at 30%.
 */
export function hasIndependentSupport(supportFiles: string[], evidencePath: string): boolean {
  return supportFiles.some((p) => p !== evidencePath);
}

export interface ConfidenceSignals {
  /** Sites that FOLLOW the rule, in the strategy's unit (files | symbols | paths). */
  followCount: number;
  /** Sites that VIOLATE it. `null` = no denominator could be measured. */
  violateCount: number | null;
  /** Distinct repo files the following sites live in. */
  supportFiles: string[];
  /** Selects the saturation target — the unit `followCount` is counted in. */
  strategy: ProbeStrategy;
  /** Size of the corpus counted over; clamps saturation for a small repo. */
  corpusSize: number;
  /** A config we actually read declares this rule, and we verified the quote. */
  configDeclared: boolean;
  /** The model's self-report. NaN / out-of-range is clamped, never propagated. */
  modelConfidence: number;
}

export interface ConfidenceBreakdown {
  confidence: number;
  conformance: number | null;
  support: number;
  spread: number;
  model: number;
  dirs: number;
  configDeclared: boolean;
  /** `INCOMPLETE_SIGNAL_CAP` bound the score — the "we couldn't check" marker. */
  capped: boolean;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Re-derive confidence from measured evidence instead of taking the model's word.
 *
 * The headline signal is CONFORMANCE — of the sites this rule governs, what share
 * follow it — because that is what makes a pattern a convention. Raw occurrence
 * count cannot express it: the old scorer counted how many files contained a
 * literal fragment, which for any naming or typing rule is exactly one (the file
 * the fragment was copied from), so every such rule scored the same ~0.3.
 *
 * Two deliberate asymmetries:
 *  - An **unavailable** signal is dropped from both numerator and denominator, not
 *    scored as 0. We do not punish a rule for our own inability to measure it —
 *    but we do cap it at `INCOMPLETE_SIGNAL_CAP`, because without a denominator
 *    there is no evidence about how often it is broken.
 *  - **Config declaration is additive**, not weighted. Most real conventions are
 *    unlinted, so treating "no lint rule says this" as a low score on a signal
 *    would penalise the majority of true rules.
 */
export function scoreConfidence(s: ConfidenceSignals): ConfidenceBreakdown {
  const total = s.followCount + (s.violateCount ?? 0);
  const conformance =
    s.violateCount === null || total === 0 ? null : clamp01(s.followCount / total);

  const target = Math.max(1, Math.min(SUPPORT_SATURATION[s.strategy], s.corpusSize));
  const support = clamp01(Math.max(0, s.followCount) / target);

  const dirs = distinctDirs(s.supportFiles);
  const spread = clamp01(dirs / SPREAD_SATURATION_DIRS);

  const model = Number.isFinite(s.modelConfidence) ? clamp01(s.modelConfidence) : 0.5;

  let num = W_SUPPORT * support + W_SPREAD * spread + W_MODEL * model;
  let den = W_SUPPORT + W_SPREAD + W_MODEL;
  if (conformance !== null) {
    num += W_CONFORMANCE * conformance;
    den += W_CONFORMANCE;
  }

  let score = num / den + (s.configDeclared ? CONFIG_DECLARED_BOOST : 0);
  const capped = conformance === null && score > INCOMPLETE_SIGNAL_CAP;
  if (capped) score = INCOMPLETE_SIGNAL_CAP;

  return {
    confidence: Math.round(clamp01(score) * 100) / 100,
    conformance,
    support,
    spread,
    model,
    dirs,
    configDeclared: s.configDeclared,
    capped,
  };
}

/**
 * Did the model quote a config file we really read, with a fragment really in it?
 *
 * Same posture as `groundCandidate`: the model contributes a pointer, never a
 * fact. A `.prettierrc` is untrusted repo content, so "this config declares my
 * rule" is a claim to verify, not an answer. An ungrounded claim costs the
 * candidate its boost — never the candidate itself, which can still stand on code.
 */
export function groundConfigEvidence(
  claim: { path: string; snippet: string } | null | undefined,
  configs: { path: string; text: string }[],
): boolean {
  if (!claim?.path || !claim.snippet) return false;
  const config = configs.find((c) => c.path === claim.path);
  if (!config) return false; // cited a config we never read → fabricated
  const probe = normalizeSnippet(claim.snippet);
  return probe.length > 0 && normalizeSnippet(config.text).includes(probe);
}

// ------------------------------------------------------------------------ dedup

const STOPWORDS = new Set([
  'a', 'all', 'always', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'by', 'do',
  'does', 'each', 'every', 'for', 'from', 'in', 'instead', 'into', 'is', 'it',
  'its', 'must', 'never', 'not', 'of', 'on', 'only', 'or', 'over', 'prefer',
  'should', 'that', 'the', 'their', 'them', 'this', 'to', 'use', 'used', 'using',
  'via', 'when', 'with',
]);

/**
 * Fold a trailing plural `s`, so a rule's "….then() chains" matches a skill body's
 * "a .then() chain". Rules are written in the plural and prose answers in the
 * singular constantly, and one such pair is enough to drop a 4-token rule from 1.0
 * to 0.75 — under the dedup threshold, so the duplicate ships. Crude on purpose:
 * both sides go through the same fold, so consistency is all that is required.
 * `-ss` is left alone (`class`, `process`).
 */
function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss')
    ? word.slice(0, -1)
    : word;
}

/** Content tokens of a rule/body: lowercased words, stopwords removed, depluralized. */
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      .map(stem),
  );
}

/**
 * Token-set CONTAINMENT (∩ over the smaller set), not Jaccard.
 *
 * All three dedup passes compare a one-line rule against something of a very
 * different size — a 2000-character skill body, another rule, a past reject.
 * Jaccard would score a rule fully restated inside a long skill body near zero
 * purely because the body says more; containment scores it 1, which is the
 * question actually being asked: "is this rule already covered?"
 */
export function similarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const tok of ta) if (tb.has(tok)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}

/**
 * WHICH of `existing` already covers `rule`, or `null`.
 *
 * The index matters since scans merge: a candidate that duplicates an existing
 * PENDING row is not just discarded — if it scored higher, it re-scores that row
 * (`refreshPending`), so the caller has to know which row it matched.
 */
export function findDuplicateIndex(rule: string, existing: string[]): number | null {
  const i = existing.findIndex((e) => similarity(rule, e) >= DEDUP_SIMILARITY);
  return i === -1 ? null : i;
}

/** Is `rule` already covered by any of `existing`? */
export function isDuplicate(rule: string, existing: string[]): boolean {
  return findDuplicateIndex(rule, existing) !== null;
}

/**
 * What the semantic dedup call (step H2) claims. Indices, never rule text.
 *
 * Both fields are optional because the schema declares them with `.default([])`,
 * which leaves them optional on the INPUT side of the inferred type — and because a
 * verdict that omits a field means "nothing to report", exactly like an empty one.
 */
export interface DedupVerdict {
  /** Groups of candidate indices that state the same rule as each other. */
  duplicate_groups?: number[][];
  /** Candidate indices that restate a rule the user already decided on. */
  covered_by_existing?: number[];
}

/**
 * Apply a semantic dedup verdict to the candidates it was asked about.
 *
 * Pure, and deliberately paranoid: the verdict is model output naming positions in
 * OUR array, so an off-by-one or a hallucinated index would delete a real
 * convention. Every index is bounds-checked, each may be spent once, and a group
 * always leaves its strongest member behind — so `duplicate_groups` can never empty
 * the list however the model groups things.
 *
 * `covered_by_existing` CAN legitimately drop everything (the user may have already
 * accepted every rule in the repo), so it is not floored — but it is ignored
 * outright when there were no decided rules to be covered by, because then there is
 * nothing the claim could be true about.
 *
 * Survivors keep their original order.
 */
export function applyDedupVerdict<T>(
  candidates: T[],
  verdict: DedupVerdict,
  confidenceOf: (candidate: T) => number,
  existingCount: number,
): T[] {
  const valid = (i: unknown): i is number =>
    typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < candidates.length;

  const dropped = new Set<number>();
  const spent = new Set<number>();

  for (const group of verdict.duplicate_groups ?? []) {
    if (!Array.isArray(group)) continue;
    // Dedupe the group itself: a repeated index must not make a 1-rule "group"
    // look like 2, which would drop the only member.
    const members = [...new Set(group.filter(valid))].filter((i) => !spent.has(i));
    if (members.length < 2) continue;
    let best = members[0]!;
    for (const i of members) {
      // Strictly greater, so the lowest index wins a tie — the same
      // best-corroborated-phrasing-survives rule the lexical pass uses.
      if (confidenceOf(candidates[i]!) > confidenceOf(candidates[best]!)) best = i;
    }
    for (const i of members) {
      spent.add(i);
      if (i !== best) dropped.add(i);
    }
  }

  if (existingCount > 0) {
    for (const i of verdict.covered_by_existing ?? []) if (valid(i)) dropped.add(i);
  }

  return candidates.filter((_, i) => !dropped.has(i));
}

// -------------------------------------------------------------- skill composure

/** An accepted rule as the merged skill body needs it. */
export interface ComposableConvention {
  rule: string;
  evidence_path: string;
  evidence_start_line?: number | null;
  evidence_end_line?: number | null;
  evidence_snippet: string;
}

/** `file:12-18`, or `file:12` when the range is a single line. */
export function formatEvidenceRef(c: ComposableConvention): string {
  const start = c.evidence_start_line ?? null;
  const end = c.evidence_end_line ?? null;
  if (start === null) return c.evidence_path;
  if (end === null || end === start) return `${c.evidence_path}:${start}`;
  return `${c.evidence_path}:${start}-${end}`;
}

/**
 * A stable `## heading` slug for a rule: its first `SLUG_MAX_WORDS` content
 * words. Stopwords are dropped so "Always use async/await instead of .then()
 * chains" heads the section as `async-await-then-chains` — the rule's subject
 * rather than its grammar.
 */
export function slugifyRule(rule: string, fallback: string): string {
  const words = rule
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .slice(0, SLUG_MAX_WORDS);
  return words.length > 0 ? words.join('-') : fallback;
}

/**
 * Merge the accepted rules into ONE skill body — the markdown the create-skill
 * modal opens with, and the text a reviewer agent will read verbatim.
 *
 * Each rule keeps its `file:line` evidence in the body on purpose: the same
 * citation the user verified in the UI is what tells the reviewer where the
 * convention is established, and it survives into the prompt.
 */
export function composeSkillBody(repoName: string, accepted: ComposableConvention[]): string {
  const parts: string[] = [
    `# ${repoName}${SKILL_NAME_SUFFIX}`,
    '',
    `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite`,
    'the offending `file:line`.',
  ];

  const used = new Set<string>();
  accepted.forEach((c, i) => {
    const base = slugifyRule(c.rule, `rule-${i + 1}`);
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    used.add(slug);

    const rule = c.rule.trim();
    parts.push(
      '',
      `## ${slug}`,
      rule.endsWith('.') ? rule : `${rule}.`,
      '',
      `Detected in \`${formatEvidenceRef(c)}\`:`,
      '',
      '```',
      c.evidence_snippet.trim(),
      '```',
    );
  });

  return parts.join('\n');
}

// -------------------------------------------------------------------- scheduling

/**
 * Map with a concurrency cap, preserving input order.
 *
 * The extraction step fires one model call per category; unbounded that is 6
 * simultaneous requests against a rate-limited provider, and `Promise.all` over
 * a slice-per-batch would idle every worker waiting for the slowest call in its
 * batch. Workers pull from a shared cursor instead.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
