import type { CiFailOn, Finding, GitHubReviewPayload, Review, UnifiedDiff } from '@devdigest/shared';
import { buildLineIndex } from '../grounding.js';

/**
 * Turn a grounded Review into a GitHubReviewPayload (markdown body + optional
 * inline comments + the GitHub review event). Pure — shared by the CI runner
 * (posts via octokit) and, eventually, the studio's Compose. Mirrors the body /
 * inline formatting used by the server's compose service so reviews look the
 * same whether posted from the studio or CI.
 *
 * The review EVENT (APPROVE / COMMENT / REQUEST_CHANGES) is computed
 * DETERMINISTICALLY from finding severities + the agent's `ci_fail_on` gate —
 * NOT from the model's self-reported `verdict` (which drifts and surprises).
 */

const SEV_EMOJI: Record<string, string> = {
  CRITICAL: '🔴',
  WARNING: '🟡',
  SUGGESTION: '🔵',
};

/** Severity rank (higher = worse) for gate comparisons. */
const SEV_RANK: Record<string, number> = { SUGGESTION: 1, WARNING: 2, CRITICAL: 3 };

/** Minimum severity rank that trips the gate, per policy. `never` → unreachable. */
const FAIL_ON_MIN_RANK: Record<CiFailOn, number> = {
  never: Number.POSITIVE_INFINITY,
  critical: 3,
  warning: 2,
  any: 1,
};

/**
 * Does this set of findings trip the CI gate under `failOn`? True → the review
 * should REQUEST_CHANGES and the CI check should fail.
 */
export function gateTriggered(findings: Finding[], failOn: CiFailOn): boolean {
  const min = FAIL_ON_MIN_RANK[failOn];
  return findings.some((f) => (SEV_RANK[f.severity] ?? 0) >= min);
}

export interface ToReviewOptions {
  /** Emit one inline comment per finding (default true). */
  inline?: boolean;
  /** Heading shown above the summary. */
  title?: string;
  /** CI gate policy — drives the review event deterministically (default 'critical'). */
  failOn?: CiFailOn;
  /**
   * Unified diff for the change. When provided, inline comments are anchored to a
   * real new-side diff line (prevents GitHub 422 "Line could not be resolved").
   * Without it, the legacy `end_line` anchor is used (non-CI callers).
   */
  diff?: UnifiedDiff;
}

function severityCounts(findings: Finding[]): string {
  const c: Record<string, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) c[f.severity] = (c[f.severity] ?? 0) + 1;
  return `${c.CRITICAL} critical · ${c.WARNING} warning · ${c.SUGGESTION} suggestion`;
}

function composeBody(
  findings: Finding[],
  event: GitHubReviewPayload['event'],
  title: string,
): string {
  const header =
    event === 'APPROVE'
      ? `## ${title} — Approved ✅`
      : event === 'REQUEST_CHANGES'
        ? `## ${title} — Changes requested`
        : `## ${title}`;

  if (findings.length === 0) return `${header}\n\n_No findings. Looks good._`;

  const lines = findings.map((f) => {
    const emoji = SEV_EMOJI[f.severity] ?? '•';
    const loc = `\`${f.file}:${f.start_line}${f.end_line !== f.start_line ? `-${f.end_line}` : ''}\``;
    const sugg = f.suggestion ? `\n  - _Suggestion:_ ${f.suggestion}` : '';
    return `- ${emoji} **${f.title}** (${f.severity.toLowerCase()}, ${f.category}) — ${loc}\n  - ${f.rationale}${sugg}`;
  });

  const summary = `**${findings.length} finding${findings.length === 1 ? '' : 's'}** · ${severityCounts(findings)}`;
  return `${header}\n\n${summary}\n\n${lines.join('\n')}\n\n_Posted via DevDigest._`;
}

/**
 * Pick a line GitHub can actually anchor an inline comment to: the new-side diff
 * line within [start_line, end_line] closest to end_line. Grounding only proves
 * the *range* intersects the diff, so `end_line` itself may be an unchanged line
 * — posting a comment there yields 422 "Line could not be resolved", and a single
 * bad line makes GitHub reject the WHOLE review. Returns null when no line in the
 * range is in the diff; the finding then stays in the summary body (never silent).
 */
function resolveCommentLine(lines: Set<number>, start: number, end: number): number | null {
  if (lines.has(end)) return end;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const n of lines) {
    if (n < lo || n > hi) continue;
    const dist = Math.abs(n - end);
    if (dist < bestDist) {
      bestDist = dist;
      best = n;
    }
  }
  return best;
}

function inlineComments(
  findings: Finding[],
  lineIndex: Map<string, Set<number>> | null,
): { path: string; line: number; body: string }[] {
  const out: { path: string; line: number; body: string }[] = [];
  for (const f of findings) {
    // With a diff index, anchor to a real diff line; drop the inline comment if
    // none resolves (the finding still appears in the summary body). Without an
    // index (non-CI callers), keep the legacy raw end_line anchor.
    const line = lineIndex
      ? resolveCommentLine(lineIndex.get(f.file) ?? new Set<number>(), f.start_line, f.end_line)
      : f.end_line;
    if (line == null) continue;
    out.push({
      path: f.file,
      line,
      body: `**${f.title}** (${f.severity.toLowerCase()})\n\n${f.rationale}${
        f.suggestion ? `\n\n_Suggestion:_ ${f.suggestion}` : ''
      }`,
    });
  }
  return out;
}

export function toReviewPayload(review: Review, opts: ToReviewOptions = {}): GitHubReviewPayload {
  const inline = opts.inline ?? true;
  const title = opts.title ?? 'DevDigest Review';
  const failOn = opts.failOn ?? 'critical';
  const lineIndex = opts.diff ? buildLineIndex(opts.diff) : null;
  const comments = inline ? inlineComments(review.findings, lineIndex) : [];
  // Deterministic event from severities + gate policy (ignores model verdict):
  // no findings → APPROVE; gate tripped → REQUEST_CHANGES; otherwise → COMMENT.
  const event: GitHubReviewPayload['event'] =
    review.findings.length === 0
      ? 'APPROVE'
      : gateTriggered(review.findings, failOn)
        ? 'REQUEST_CHANGES'
        : 'COMMENT';
  return {
    body: composeBody(review.findings, event, title),
    event,
    ...(comments.length ? { comments } : {}),
  };
}
