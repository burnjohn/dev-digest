import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionSkillDraft,
} from '@devdigest/shared';
import type { ConventionRow } from '../../db/rows.js';
import {
  MAX_FILE_CHARS,
  MAX_FILE_LINES,
  MAX_SNIPPET_LINES,
  MIN_SNIPPET_CHARS,
} from './constants.js';

/**
 * Pure helpers for the Conventions Extractor. Everything here is deterministic
 * and unit-tested: the sample rendering the model sees, the evidence gate that
 * decides which of its candidates survive, and the skill markdown assembled
 * from the accepted ones. No IO, no model, no DB.
 */

// ---- sampling ------------------------------------------------------------

export interface SampledFile {
  path: string;
  /** File content as read, already truncated to the per-file caps. */
  text: string;
  lines: string[];
  truncated: boolean;
}

/** Truncate to the per-file caps and split once, so callers reuse the lines. */
export function toSampledFile(path: string, raw: string): SampledFile {
  const byChars = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) : raw;
  const allLines = byChars.split('\n');
  const lines = allLines.slice(0, MAX_FILE_LINES);
  return {
    path,
    text: lines.join('\n'),
    lines,
    truncated: lines.length < allLines.length || byChars.length < raw.length,
  };
}

/**
 * Render one file for the prompt with 1-based line numbers.
 *
 * The numbers are the whole point: the model is asked to cite `file` + `line` +
 * a verbatim snippet, and a numbered listing is what makes that citation
 * mechanically checkable afterwards. Without them the model guesses line
 * numbers and the evidence gate drops nearly everything.
 */
export function renderSample(file: SampledFile): string {
  const body = file.lines.map((l, i) => `${i + 1}\t${l}`).join('\n');
  const suffix = file.truncated ? '\n… (truncated)' : '';
  return `--- FILE: ${file.path} ---\n${body}${suffix}`;
}

/** Join rendered samples, stopping before `maxChars` so the prompt stays bounded. */
export function renderSamples(files: SampledFile[], maxChars: number): string {
  const out: string[] = [];
  let used = 0;
  for (const f of files) {
    const block = renderSample(f);
    if (used + block.length > maxChars) break;
    out.push(block);
    used += block.length + 2;
  }
  return out.join('\n\n');
}

// ---- the evidence gate ---------------------------------------------------

/** What the model returns, before any verification. */
export interface RawCandidate {
  category: string;
  rule: string;
  rationale?: string | null;
  evidence_path: string;
  evidence_line?: number | null;
  evidence_snippet: string;
  confidence: number;
}

export interface VerifiedCandidate {
  category: ConventionCategory;
  rule: string;
  rationale: string | null;
  evidencePath: string;
  evidenceLine: number;
  /** Taken FROM THE FILE, not from the model — displayed evidence is real code. */
  evidenceSnippet: string;
  confidence: number;
}

export type DropReason = 'unknown_file' | 'snippet_too_short' | 'snippet_not_found' | 'empty_rule';

export type VerifyResult =
  | { ok: true; candidate: VerifiedCandidate }
  | { ok: false; reason: DropReason };

const CATEGORIES: readonly ConventionCategory[] = [
  'naming',
  'structure',
  'errors',
  'testing',
  'imports',
  'typing',
  'api',
  'general',
];

/** Whitespace-insensitive, case-insensitive comparison key for a code line. */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Verify one candidate against the files we actually sampled.
 *
 * Three independent checks, all in code — no second model call:
 *  1. the cited path is one we sampled (a path we never sent is invented);
 *  2. the snippet is substantial enough to identify a line;
 *  3. the snippet's first meaningful line really occurs in that file.
 *
 * When the model's line number is wrong but the code is there, we CORRECT the
 * line rather than drop the candidate — an off-by-a-few line number is a
 * counting mistake, not a hallucinated rule. The snippet we keep is re-read
 * from the file, so what the UI shows is always the repo's own bytes.
 */
export function verifyCandidate(
  files: Map<string, SampledFile>,
  c: RawCandidate,
): VerifyResult {
  if (!c.rule?.trim()) return { ok: false, reason: 'empty_rule' };

  const file = resolveFile(files, c.evidence_path);
  if (!file) return { ok: false, reason: 'unknown_file' };

  const snippetLines = (c.evidence_snippet ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*\d+\t/, '')) // the model sometimes echoes our line-number gutter
    .filter((l) => l.trim().length > 0);
  const head = snippetLines[0];
  if (!head || norm(head).replace(/\s/g, '').length < MIN_SNIPPET_CHARS) {
    return { ok: false, reason: 'snippet_too_short' };
  }

  const idx = findLine(file.lines, head, c.evidence_line ?? null);
  if (idx === -1) return { ok: false, reason: 'snippet_not_found' };

  const span = Math.min(Math.max(snippetLines.length, 1), MAX_SNIPPET_LINES);
  const snippet = dedent(file.lines.slice(idx, idx + span)).join('\n').trimEnd();

  return {
    ok: true,
    candidate: {
      category: CATEGORIES.includes(c.category as ConventionCategory)
        ? (c.category as ConventionCategory)
        : 'general',
      rule: c.rule.trim(),
      rationale: c.rationale?.trim() || null,
      evidencePath: file.path,
      evidenceLine: idx + 1,
      evidenceSnippet: snippet,
      confidence: Math.min(1, Math.max(0, c.confidence ?? 0)),
    },
  };
}

/**
 * Match a cited path to a sampled one. Exact first; then a unique suffix match,
 * because models routinely cite `src/api/users.ts` as `./src/api/users.ts` or
 * `users.ts`. Ambiguous suffixes are NOT resolved — guessing which file was
 * meant would defeat the gate.
 */
function resolveFile(files: Map<string, SampledFile>, cited: string): SampledFile | undefined {
  if (!cited) return undefined;
  const clean = cited.trim().replace(/^\.?\//, '').split(':')[0]!;
  const exact = files.get(clean);
  if (exact) return exact;
  const matches = [...files.values()].filter(
    (f) => f.path === clean || f.path.endsWith(`/${clean}`),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Index of the line whose normalized text contains the snippet head. Prefers
 * the line nearest the model's own claim, so a repeated line (`}`, `import`)
 * resolves to the one it meant.
 */
function findLine(lines: string[], head: string, claimed: number | null): number {
  const needle = norm(head);
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = norm(lines[i]!);
    if (line && (line === needle || line.includes(needle))) hits.push(i);
  }
  if (hits.length === 0) return -1;
  if (claimed == null) return hits[0]!;
  const target = claimed - 1;
  return hits.reduce((best, i) => (Math.abs(i - target) < Math.abs(best - target) ? i : best));
}

/** Strip the common leading indentation so a nested snippet reads cleanly. */
function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^\s*/)?.[0].length ?? 0);
  const min = indents.length ? Math.min(...indents) : 0;
  return min > 0 ? lines.map((l) => l.slice(min)) : lines;
}

// ---- dedupe --------------------------------------------------------------

/** Comparison key for "the same rule said twice" (across scans, too). */
export function ruleKey(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/[`'"*_.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drop candidates that repeat a rule already in `seen` (previous scans' kept
 * decisions) or each other. First occurrence wins, so the highest-confidence
 * one survives when the caller sorts before calling.
 */
export function dedupeCandidates(
  candidates: VerifiedCandidate[],
  seen: Iterable<string> = [],
): { kept: VerifiedCandidate[]; dropped: number } {
  const keys = new Set(seen);
  const kept: VerifiedCandidate[] = [];
  for (const c of candidates) {
    const key = ruleKey(c.rule);
    if (keys.has(key)) continue;
    keys.add(key);
    kept.push(c);
  }
  return { kept, dropped: candidates.length - kept.length };
}

// ---- DTO + skill assembly ------------------------------------------------

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    repo_id: row.repoId,
    category: row.category,
    rule: row.rule,
    rationale: row.rationale,
    evidence_path: row.evidencePath ?? '',
    evidence_line: row.evidenceLine,
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    status: row.status,
    created_at: row.createdAt?.toISOString() ?? null,
  };
}

/** `Always use async/await …` → `always-use-async-await` (skill section anchor). */
export function slugify(text: string, maxWords = 6): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, maxWords)
      .join('-') || 'rule'
  );
}

/** `acme/payments-api` → `payments-api`; used for the skill's name. */
export function repoSlug(fullName: string): string {
  const tail = fullName.split('/').pop() ?? fullName;
  return slugify(tail, 8);
}

/**
 * Assemble accepted candidates into a skill draft. The body is markdown the
 * user edits before saving — this is a starting point, not a final artifact.
 *
 * Every rule carries its `file:line` evidence into the prompt on purpose: it
 * tells the reviewing model the rule is real in THIS repo and gives it a
 * concrete shape to compare a diff against.
 */
export function buildSkillDraft(
  repoFullName: string,
  rows: ConventionRow[],
): ConventionSkillDraft {
  const short = repoSlug(repoFullName);
  const name = `${short}-conventions`;
  const sections = rows.map((r) => {
    const lines = [`## ${slugify(r.rule)}`, r.rule.trim()];
    if (r.rationale?.trim()) lines.push('', r.rationale.trim());
    if (r.evidencePath) {
      const at = r.evidenceLine ? `${r.evidencePath}:${r.evidenceLine}` : r.evidencePath;
      lines.push('', `Detected in \`${at}\`:`, '', '```', r.evidenceSnippet ?? '', '```');
    }
    return lines.join('\n');
  });

  const body = [
    `# ${name}`,
    '',
    `House conventions for \`${repoFullName}\`, extracted from the repository and confirmed by a maintainer. Flag changes that violate any rule below and cite the offending \`file:line\`. A rule that does not apply to the diff under review is not a finding.`,
    '',
    ...sections,
  ].join('\n');

  const evidenceFiles = [...new Set(rows.map((r) => r.evidencePath).filter((p): p is string => !!p))];

  return {
    name,
    description: `${rows.length} house convention${rows.length === 1 ? '' : 's'} extracted from ${repoFullName}`,
    type: 'convention',
    body,
    evidence_files: evidenceFiles,
    convention_ids: rows.map((r) => r.id),
  };
}
