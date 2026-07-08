/**
 * brief-generator-helpers — PURE functions for the Risk Brief LLM generation
 * pipeline (PR Why + Risk Brief feature). No DB, no network, no `container`,
 * no side effects of any kind — every external fact is passed in by the
 * caller (`brief-generator.ts`, Step 4).
 *
 * Two independent concerns live here:
 *  1. `assembleLlmInput` — bounded-budget section assembly (Resolution 2).
 *  2. `validateReferences` / `buildGithubBlobLink` / `firstChangedLineFromPatch`
 *     — deterministic 3-tier reference validation/repair (Resolution 3), zero
 *     LLM calls. `firstChangedLineFromPatch` provides a meaningful default
 *     line (the file's first changed diff line) when the LLM omits one —
 *     the caller applies it since only the caller has per-file patches.
 */
import path from 'node:path';
import { wrapUntrusted } from '@devdigest/reviewer-core';
import type { DownstreamImpact, Intent, PrHistoryItem } from '@devdigest/shared';

// Re-exported so callers that only need untrusted-wrapping can import it from
// this module too, without reaching into reviewer-core directly.
export { wrapUntrusted };

// ---------------------------------------------------------------------------
// Section assembly + budget (Resolution 2)
// ---------------------------------------------------------------------------

/**
 * Soft token budget for the assembled LLM input. Defined LOCALLY (not
 * imported from `./constants.js`) so this file stays independently
 * compilable before Step 5 adds/re-exports the same value there. Step 5 can
 * re-export this constant or reconcile the two — see the module docstring in
 * that step's plan entry.
 */
export const BRIEF_INPUT_TOKEN_BUDGET = 8000;

/** PR body is truncated at this many characters before being included. */
const MAX_PR_BODY_CHARS = 4000;

const MAX_DOWNSTREAM_ENTRIES = 10;
const MAX_DIFF_STATS_FILES = 15;
const MAX_DIFF_STATS_FILES_HALVED = 8;
const MAX_PSEUDOCODE_SUMMARY_CHARS = 300;
const MAX_FINDINGS = 10;
const MAX_FINDING_RATIONALE_CHARS = 150;
const MAX_HISTORY_NOTES = 5;
const MAX_HISTORY_NOTE_CHARS = 150;

/** Role priority for sorting diff stats: core → wiring → boilerplate. */
const ROLE_PRIORITY: Record<'core' | 'wiring' | 'boilerplate', number> = {
  core: 0,
  wiring: 1,
  boilerplate: 2,
};

export interface DiffStatEntry {
  path: string;
  role: 'core' | 'wiring' | 'boilerplate';
  additions: number;
  deletions: number;
  pseudocode_summary: string | null;
}

export interface FindingSummaryEntry {
  title: string;
  rationale: string;
}

export interface ContextExcerptEntry {
  path: string;
  content: string;
}

/** Bundled deterministic facts consumed by `assembleLlmInput`. */
export interface BriefInputFacts {
  intent: Intent;
  blastSummary: { summary: string; topDownstream: DownstreamImpact[] };
  diffStats: DiffStatEntry[];
  findings: FindingSummaryEntry[];
  prTitle: string;
  prBody: string | null;
  history: PrHistoryItem[];
  contextExcerpts: ContextExcerptEntry[];
}

export interface AssembleLlmInputResult {
  input: string;
  sectionsIncluded: string[];
  sectionsDropped: string[];
}

function truncate(s: string, maxChars: number): string {
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
}

/** Reimplemented locally — do NOT import from `run-executor.ts` (module isolation). */
function sortByRolePriority<T extends { role: 'core' | 'wiring' | 'boilerplate' }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => ROLE_PRIORITY[a.role] - ROLE_PRIORITY[b.role]);
}

function buildIntentSection(intent: Intent): string {
  const lines = [
    '## Intent',
    `Intent: ${intent.intent}`,
    `In scope: ${intent.in_scope.join(', ') || '(none)'}`,
    `Out of scope: ${intent.out_of_scope.join(', ') || '(none)'}`,
  ];
  return lines.join('\n');
}

function buildBlastSection(blastSummary: BriefInputFacts['blastSummary']): string {
  const top = blastSummary.topDownstream.slice(0, MAX_DOWNSTREAM_ENTRIES);
  const lines = [
    '## Blast summary',
    blastSummary.summary,
    ...top.map(
      (d) =>
        `- ${d.symbol}: ${d.callers.length} caller(s), endpoints=[${d.endpoints_affected.join(', ')}], crons=[${d.crons_affected.join(', ')}]`,
    ),
  ];
  return lines.join('\n');
}

function buildDiffStatsSection(diffStats: DiffStatEntry[], cap: number): string {
  const sorted = sortByRolePriority(diffStats).slice(0, cap);
  const lines = [
    '## Diff stats',
    ...sorted.map((f) => {
      const summary = f.pseudocode_summary ? truncate(f.pseudocode_summary, MAX_PSEUDOCODE_SUMMARY_CHARS) : '(no summary)';
      return `- [${f.role}] ${f.path} (+${f.additions}/-${f.deletions}): ${summary}`;
    }),
  ];
  return lines.join('\n');
}

function buildFindingsSection(findings: FindingSummaryEntry[]): string {
  const capped = findings.slice(0, MAX_FINDINGS);
  const lines = [
    '## Findings',
    ...capped.map((f) => `- ${f.title}: ${truncate(f.rationale, MAX_FINDING_RATIONALE_CHARS)}`),
  ];
  return lines.join('\n');
}

function buildPrBodySection(prTitle: string, prBody: string | null): string {
  const body = prBody ? truncate(prBody, MAX_PR_BODY_CHARS) : '(no description)';
  return ['## PR', `Title: ${prTitle}`, `Body: ${body}`].join('\n');
}

function buildHistorySection(history: PrHistoryItem[]): string {
  const capped = history.slice(0, MAX_HISTORY_NOTES);
  const lines = [
    '## History notes',
    ...capped.map((h) => `- PR #${h.pr_number} (${h.title}): ${truncate(h.notes, MAX_HISTORY_NOTE_CHARS)}`),
  ];
  return lines.join('\n');
}

function buildContextExcerptsSection(excerpts: ContextExcerptEntry[]): string {
  const lines = [
    '## Context excerpts',
    ...excerpts.map((e) => `### ${e.path}\n${wrapUntrusted(`context-doc:${e.path}`, e.content)}`),
  ];
  return lines.join('\n');
}

/**
 * Assemble the bounded LLM input from deterministic facts, respecting the
 * §12 section-priority drop order when the soft token budget is exceeded.
 * Never throws — always returns a fitting (or best-effort) input string.
 */
export function assembleLlmInput(
  facts: BriefInputFacts,
  countTokens: (s: string) => number,
  tokenBudget: number = BRIEF_INPUT_TOKEN_BUDGET,
): AssembleLlmInputResult {
  // Section 1 (intent) is never dropped — build it once, outside the loop.
  const intentSection = buildIntentSection(facts.intent);

  // Mutable drop state for sections 3 (diff stats), 6 (history), 7 (context).
  let diffStatsCap = MAX_DIFF_STATS_FILES;
  let includeHistory = true;
  let includeContext = true;

  // sectionsDropped is appended to in DROP-PRIORITY order (7 then 6 then 3),
  // not document-position order — this is what the §12 log line reports.
  const sectionsDropped: string[] = [];

  function buildSections(): { input: string; included: string[] } {
    const parts: string[] = [intentSection];
    const included: string[] = ['intent'];

    parts.push(buildBlastSection(facts.blastSummary));
    included.push('blast_summary');

    parts.push(buildDiffStatsSection(facts.diffStats, diffStatsCap));
    included.push('diff_stats');

    parts.push(buildFindingsSection(facts.findings));
    included.push('findings');

    parts.push(buildPrBodySection(facts.prTitle, facts.prBody));
    included.push('pr_body');

    if (includeHistory) {
      parts.push(buildHistorySection(facts.history));
      included.push('history');
    }

    if (includeContext) {
      parts.push(buildContextExcerptsSection(facts.contextExcerpts));
      included.push('context_excerpts');
    }

    return { input: parts.join('\n\n'), included };
  }

  let { input, included: sectionsIncluded } = buildSections();

  // Drop order: 7 (context) -> 6 (history) -> halve 3 (diff stats).
  // Stop as soon as it fits. Never throw/reject.
  if (countTokens(input) > tokenBudget && includeContext) {
    includeContext = false;
    sectionsDropped.push('context_excerpts');
    ({ input, included: sectionsIncluded } = buildSections());
  }
  if (countTokens(input) > tokenBudget && includeHistory) {
    includeHistory = false;
    sectionsDropped.push('history');
    ({ input, included: sectionsIncluded } = buildSections());
  }
  if (countTokens(input) > tokenBudget && diffStatsCap > MAX_DIFF_STATS_FILES_HALVED) {
    diffStatsCap = MAX_DIFF_STATS_FILES_HALVED;
    ({ input, included: sectionsIncluded } = buildSections());
  }

  return { input, sectionsIncluded, sectionsDropped };
}

// ---------------------------------------------------------------------------
// Reference validation/repair (Resolution 3)
// ---------------------------------------------------------------------------

export interface RawLlmReference {
  file?: string;
  symbol?: string;
  endpoint?: string;
  line?: number;
}

export interface KnownFacts {
  knownFiles: Set<string>;
  knownSymbols: Map<string, string>;
  knownEndpoints: Set<string>;
}

export type ValidatedReference =
  | { resolved: true; file?: string; symbol?: string; endpoint?: string; line?: number }
  | { resolved: false };

/** Normalize an endpoint string for param-agnostic comparison: `:id`/`{id}` -> `:param`. */
function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/:[A-Za-z0-9_]+/g, ':param').replace(/\{[A-Za-z0-9_]+\}/g, ':param');
}

/**
 * Deterministic 3-tier reference validation/repair. Never guesses when
 * ambiguous (Tier 2 requires exactly one basename match).
 *
 * Line contract: `line` is passed through AS-IS from the input entry (may be
 * `undefined`) — this function does NOT default an absent/meaningless line to
 * `1`. That decision belongs to the caller (`BriefGeneratorService`), which
 * has access to the file's first-changed-line-from-patch fallback and can
 * make a meaningful default; `1` is almost never a real changed line.
 */
export function validateReferences(
  entries: RawLlmReference[],
  knownFacts: KnownFacts,
): ValidatedReference[] {
  return entries.map((entry) => resolveOne(entry, knownFacts));
}

function resolveOne(entry: RawLlmReference, knownFacts: KnownFacts): ValidatedReference {
  const { knownFiles, knownSymbols, knownEndpoints } = knownFacts;

  // ---- Tier 1: exact match (file in knownFiles OR symbol in knownSymbols) ----
  if (entry.symbol && knownSymbols.has(entry.symbol)) {
    const symbolFile = knownSymbols.get(entry.symbol)!;
    return {
      resolved: true,
      file: symbolFile,
      symbol: entry.symbol,
      line: entry.line,
    };
  }
  if (entry.file && knownFiles.has(entry.file)) {
    return {
      resolved: true,
      file: entry.file,
      symbol: entry.symbol,
      line: entry.line,
    };
  }

  // ---- Tier 2: basename repair (exactly one match — never guess) ----
  if (entry.file) {
    const candidateBasename = path.basename(entry.file);
    const matches = [...knownFiles].filter((f) => path.basename(f) === candidateBasename);
    if (matches.length === 1) {
      return {
        resolved: true,
        file: matches[0],
        symbol: entry.symbol,
        line: entry.line,
      };
    }
    // zero matches or more than one match -> Tier 2 does NOT match; fall through.
  }

  // ---- Tier 3: endpoint match (exact or normalized) ----
  if (entry.endpoint) {
    if (knownEndpoints.has(entry.endpoint)) {
      return { resolved: true, endpoint: entry.endpoint, line: entry.line };
    }
    const normalizedCandidate = normalizeEndpoint(entry.endpoint);
    for (const known of knownEndpoints) {
      if (normalizeEndpoint(known) === normalizedCandidate) {
        return { resolved: true, endpoint: known, line: entry.line };
      }
    }
  }

  return { resolved: false };
}

/** Matches a unified-diff hunk header, capturing the new-side start line
 *  (`c` in `@@ -a,b +c,d @@`). The `,d` length part is optional (omitted when
 *  the hunk is exactly 1 line long), so it is captured but not required. */
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * First changed (added/context) line number on the NEW side of a unified-diff
 * patch — used as a sensible default target line when the LLM omits one.
 * Returns null when no hunk is found.
 *
 * Walks the FIRST hunk only (multiple hunks -> first hunk wins): starts
 * tracking at the hunk's new-side start line `c`, increments on context
 * (` ` prefix) and added (`+` prefix, excluding the `+++` file header) lines,
 * does NOT increment on removed (`-` prefix) lines. Returns the line number
 * of the first actual `+` line found; if the first hunk has no `+` line
 * (context-only), returns the hunk's start line `c` instead.
 */
export function firstChangedLineFromPatch(patch: string | null | undefined): number | null {
  if (!patch) return null;
  const lines = patch.split('\n');

  let hunkStart = -1;
  let newLine = -1;
  let inFirstHunk = false;
  for (const line of lines) {
    const match = HUNK_HEADER_RE.exec(line);
    if (match) {
      if (inFirstHunk) break; // second hunk header reached — first hunk wins, stop here.
      hunkStart = Number(match[1]);
      newLine = hunkStart;
      inFirstHunk = true;
      continue;
    }
    if (!inFirstHunk) continue; // haven't reached the first hunk yet

    if (line.startsWith('+++')) continue; // file header line, not a diff line
    if (line.startsWith('+')) return newLine; // first actual added line found
    if (line.startsWith(' ')) {
      newLine++;
      continue;
    }
    if (line.startsWith('-')) continue; // removed line — does not advance new-side counter
    // Any other line (e.g. "\ No newline at end of file") ends the first
    // hunk's body — stop walking further hunks.
    break;
  }

  return hunkStart === -1 ? null : hunkStart;
}

/**
 * Build a GitHub blob deep-link. Same shape as the client's `githubBlobUrl` /
 * `SymbolImpact.tsx`'s `ghBlobUrl` — deliberately duplicated here (~10 lines)
 * rather than imported across the server/client boundary.
 * `https://github.com/{repoFullName}/blob/{headSha}/{encodedPath}#L{line}`
 */
export function buildGithubBlobLink(
  repoFullName: string,
  headSha: string,
  file: string,
  line?: number,
): string {
  const encodedPath = file
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const base = `https://github.com/${repoFullName}/blob/${headSha}/${encodedPath}`;
  return line != null ? `${base}#L${line}` : base;
}
