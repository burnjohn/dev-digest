/**
 * A2 — pure helpers for the review service (extracted from service.ts; no
 * behaviour change). These functions are side-effect free and operate purely on
 * their arguments (no DB / network / `this`).
 */
import type { Finding, Intent, Review, UnifiedDiff } from '@devdigest/shared';
import type { FindingRow, PullRow, ReviewRow } from './repository.js';
import {
  BOILERPLATE_RE,
  MAX_FINDINGS_PER_REVIEW,
  MEMORY_QUERY_MAX_CHARS,
  VERDICT_RANK,
  WIRING_RE,
} from './constants.js';

export interface ReviewDtoFinding extends Finding {
  review_id: string;
  accepted_at: string | null;
  dismissed_at: string | null;
}

export interface ReviewDto {
  id: string;
  pr_id: string;
  agent_id: string | null;
  agent_name?: string | null;
  kind: 'summary' | 'review';
  verdict: string | null;
  summary: string | null;
  score: number | null;
  model: string | null;
  grounding?: string | null;
  created_at: string;
  findings: ReviewDtoFinding[];
}

export function findingRowToDto(row: FindingRow): ReviewDtoFinding {
  return {
    id: row.id,
    severity: row.severity as Finding['severity'],
    category: row.category as Finding['category'],
    title: row.title,
    file: row.file,
    start_line: row.startLine,
    end_line: row.endLine,
    rationale: row.rationale,
    suggestion: row.suggestion ?? null,
    confidence: row.confidence,
    kind: (row.kind as Finding['kind']) ?? 'finding',
    trifecta_components: (row.trifectaComponents as Finding['trifecta_components']) ?? null,
    evidence: null,
    review_id: row.reviewId,
    accepted_at: row.acceptedAt?.toISOString() ?? null,
    dismissed_at: row.dismissedAt?.toISOString() ?? null,
  };
}

export function reviewToDto(
  review: ReviewRow,
  findings: FindingRow[],
  agentName?: string | null,
): ReviewDto {
  return {
    id: review.id,
    pr_id: review.prId,
    agent_id: review.agentId,
    agent_name: agentName ?? null,
    kind: review.kind as 'summary' | 'review',
    verdict: review.verdict,
    summary: review.summary,
    score: review.score,
    model: review.model,
    created_at: review.createdAt.toISOString(),
    findings: findings.map(findingRowToDto),
  };
}

/** Merge per-file Reviews: union findings, worst verdict, mean score. */
export function reduceReviews(partials: Review[]): Review {
  if (partials.length === 1) return partials[0]!;
  const findings = partials.flatMap((p) => p.findings);
  let verdict: Review['verdict'] = 'approve';
  for (const p of partials) {
    if ((VERDICT_RANK[p.verdict] ?? 0) > (VERDICT_RANK[verdict] ?? 0)) verdict = p.verdict;
  }
  const score = partials.length
    ? Math.round(partials.reduce((s, p) => s + p.score, 0) / partials.length)
    : 0;
  const summary = partials.map((p) => p.summary).filter(Boolean).join(' ');
  return { verdict, score, summary, findings };
}

/** Mark findings whose file falls under an out_of_scope hint (downgrade only). */
export function flagOutOfScope(findings: Finding[], intent: Intent | undefined): Finding[] {
  if (!intent || intent.out_of_scope.length === 0) return findings;
  const oos = intent.out_of_scope.map((s) => s.toLowerCase());
  return findings.map((f) => {
    const inOos = oos.some(
      (o) => f.file.toLowerCase().includes(o) || o.includes(f.file.toLowerCase()),
    );
    if (inOos && f.severity === 'CRITICAL') {
      return { ...f, severity: 'WARNING' as const };
    }
    return f;
  });
}

/** Classify a changed file into a smart-diff role by path heuristics. */
export function classifyFile(path: string): 'core' | 'wiring' | 'boilerplate' {
  const p = path.toLowerCase();
  if (BOILERPLATE_RE.test(p)) return 'boilerplate';
  if (WIRING_RE.test(p)) return 'wiring';
  return 'core';
}

/** Extract the slice of the unified diff for a single file. */
export function sliceDiff(diff: UnifiedDiff, path: string): string {
  const lines = diff.raw.split('\n');
  const out: string[] = [];
  let capture = false;
  for (const line of lines) {
    if (line.startsWith('diff --git'))
      capture = line.includes(`b/${path}`) || line.includes(` ${path}`);
    if (capture) out.push(line);
  }
  if (out.length > 0) return out.join('\n');
  // fallback: synthesize from the file's hunks
  const f = diff.files.find((x) => x.path === path);
  if (!f) return diff.raw;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}`;
}

/** Build the per-run task instruction line for a PR (+ optional intent hints). */
export function taskLine(pull: PullRow, intent: Intent | undefined): string {
  const base = `Review pull request #${pull.number} "${pull.title}" by ${pull.author}. Return at most ${MAX_FINDINGS_PER_REVIEW} high-value findings, each citing an exact file and line range that appears in the diff.`;
  if (intent) {
    return `${base}\nPR intent: ${intent.intent}\nIn scope: ${intent.in_scope.join(
      ', ',
    )}\nOut of scope (do NOT flag): ${intent.out_of_scope.join(', ')}`;
  }
  return base;
}

/** Build the memory-retrieval query from a PR's title + body. */
export function memoryQuery(pull: PullRow): string {
  return `${pull.title}\n${pull.body ?? ''}`.slice(0, MEMORY_QUERY_MAX_CHARS);
}

/** First source PR number for a memory hit (if any). */
export function sourcePr(m: { sources: { pr?: number | null }[] }): number | null {
  return m.sources?.[0]?.pr ?? null;
}

/** Compose the memory note content learned from a finding (+ optional reply). */
export function findingMemoryContent(finding: FindingRow, reply?: string): string {
  const base = `${finding.title} — ${finding.rationale}`;
  return reply ? `${base}\n\nReviewer note: ${reply}` : base;
}
