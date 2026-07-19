import type {
  BlastRadius,
  BlastRelatedPr,
  CallerRole,
  ChangedSymbol,
  DownstreamImpact,
  Severity,
} from '@devdigest/shared';
import {
  BOILERPLATE_FILE_RE,
  BUSINESS_RANK_THRESHOLD,
  CALL_SITE_SCAN_LINES,
  TEST_FILE_RE,
} from './constants.js';

/**
 * Deterministic reviewer signals for the blast radius — ALL derived from data
 * already in the PR (file paths, repo-intel ranks, the cloned source, the diff,
 * and existing agent findings). No model call anywhere in this file.
 */

/** Classify a caller by what kind of code it is (see CallerRole). */
export function classifyCaller(
  file: string,
  opts: { rank?: number; hasEndpointOrCron?: boolean } = {},
): CallerRole {
  if (TEST_FILE_RE.test(file)) return 'test';
  if (BOILERPLATE_FILE_RE.test(file)) return 'boilerplate';
  if (opts.hasEndpointOrCron || (opts.rank ?? 0) >= BUSINESS_RANK_THRESHOLD) return 'business';
  return 'normal';
}

const LOOP_RE = /\b(for|while)\s*\(|\bdo\s*\{|\.(forEach|map|reduce|filter|some|every|flatMap|reduceRight)\s*\(/;

/**
 * Inspect a call site in its source file: is it inside a loop, and is it guarded
 * by a try/catch? Walks UPWARD from the call line, tracking brace depth; each
 * time depth drops below the call's own level we've found an enclosing block —
 * inspect its opening line. Heuristic (brace counting ignores strings/comments)
 * but cheap and good enough to flag hot / unguarded call sites.
 *
 * @param lines  the caller file split into lines (0-indexed)
 * @param line   1-based line number of the call
 */
export function analyzeCallSite(lines: string[], line: number): { inLoop: boolean; guarded: boolean } {
  let inLoop = false;
  let guarded = false;
  let depth = 0;
  const start = Math.min(line - 1, lines.length) - 1; // line above the call (0-indexed)
  const floor = Math.max(0, start - CALL_SITE_SCAN_LINES);
  for (let i = start; i >= floor; i--) {
    const l = lines[i] ?? '';
    depth += countChar(l, '}') - countChar(l, '{');
    if (depth < 0) {
      // `l` opens a block that encloses the call site.
      if (LOOP_RE.test(l)) inLoop = true;
      if (/\btry\b\s*\{?/.test(l)) guarded = true;
      depth = 0; // keep climbing to find outer enclosing blocks too
    }
    if (inLoop && guarded) break;
  }
  return { inLoop, guarded };
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}

/** Does a file's PR patch ADD a `throw` (a new way to fail)? Reads +lines only. */
export function patchAddsThrow(patch: string | null | undefined): boolean {
  if (!patch) return false;
  for (const l of patch.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++') && /\bthrow\b/.test(l)) return true;
  }
  return false;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Did this PR edit the DECLARATION of `symbol` (its signature/interface), not
 * just its body? True when the patch both REMOVES and ADDS a line that declares
 * the symbol — `function foo(`, `class/interface/type foo`, `foo(...) {`,
 * `foo: (...) =>`, `foo = (...) =>`. A changed signature on an endpoint-reachable
 * symbol is a breaking-integration risk. Heuristic, but no model call.
 */
export function patchChangesSignature(patch: string | null | undefined, symbol: string): boolean {
  if (!patch) return false;
  const n = escapeRe(symbol);
  const decl = new RegExp(
    `\\b(function|class|interface|type|enum)\\s+${n}\\b` + // declared entity
      `|\\b${n}\\s*[(<]` + // call/generic signature: foo( or foo<
      `|\\b${n}\\s*[:=]\\s*(async\\s*)?(function\\b|\\()`, // foo: (…)=> / foo = (…)=>
  );
  let removed = false;
  let added = false;
  for (const l of patch.split('\n')) {
    if (l.startsWith('+') && !l.startsWith('+++') && decl.test(l)) added = true;
    else if (l.startsWith('-') && !l.startsWith('---') && decl.test(l)) removed = true;
    if (added && removed) return true;
  }
  return false;
}

const SEV_RANK: Record<Severity, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

/** The worst (highest-ranked) severity in a list, or null when empty. */
export function worstSeverity(sevs: Severity[]): Severity | null {
  let best: Severity | null = null;
  for (const s of sevs) if (best === null || SEV_RANK[s] > SEV_RANK[best]) best = s;
  return best;
}

export interface EnrichInput {
  /** Existing agent findings (file + severity) to cross-reference. */
  findings: { file: string; severity: Severity }[];
  /** Whether any agent review existed (distinguishes "0 findings" from "not run"). */
  hasReview: boolean;
  /** Prior PRs touching the same files. */
  relatedPrs: BlastRelatedPr[];
}

/**
 * Fold the deterministic context into an assembled BlastRadius:
 *   - cross-reference agent findings onto each changed symbol (worst severity +
 *     count, keyed by the symbol's declaring file);
 *   - surface `dead_symbols` — changed symbols with NO external callers;
 *   - attach related PRs + the findings-available flag.
 * Pure: same inputs → same output. Callers (roles / loop / guard / may_throw)
 * are already set on the downstream by the service before this runs.
 */
export function enrichBlast(blast: BlastRadius, input: EnrichInput): BlastRadius {
  const byFile = new Map<string, { sevs: Severity[]; count: number }>();
  for (const f of input.findings) {
    const e = byFile.get(f.file) ?? { sevs: [], count: 0 };
    e.sevs.push(f.severity);
    e.count++;
    byFile.set(f.file, e);
  }

  const downstream: DownstreamImpact[] = blast.downstream.map((d) => {
    const hit = d.file ? byFile.get(d.file) : undefined;
    return {
      ...d,
      finding_severity: hit ? worstSeverity(hit.sevs) : null,
      finding_count: hit?.count ?? 0,
    };
  });

  const liveNames = new Set(blast.downstream.map((d) => d.symbol));
  const dead_symbols: ChangedSymbol[] = blast.changed_symbols.filter((s) => !liveNames.has(s.name));

  return {
    ...blast,
    downstream,
    dead_symbols,
    related_prs: input.relatedPrs,
    findings_available: input.hasReview,
  };
}
