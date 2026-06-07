import type { Finding, GitHubReviewPayload, Review, Verdict } from '@devdigest/shared';

/**
 * Turn a grounded Review into a GitHubReviewPayload (markdown body + optional
 * inline comments + the GitHub review event). Pure — shared by the CI runner
 * (posts via octokit) and, eventually, the studio's Compose. Mirrors the body /
 * inline formatting used by the server's compose service so reviews look the
 * same whether posted from the studio or CI.
 */

const VERDICT_EVENT: Record<Verdict, GitHubReviewPayload['event']> = {
  approve: 'APPROVE',
  request_changes: 'REQUEST_CHANGES',
  comment: 'COMMENT',
};

const SEV_EMOJI: Record<string, string> = {
  CRITICAL: '🔴',
  WARNING: '🟡',
  SUGGESTION: '🔵',
};

export interface ToReviewOptions {
  /** Emit one inline comment per finding (default true). */
  inline?: boolean;
  /** Heading shown above the summary. */
  title?: string;
}

function severityCounts(findings: Finding[]): string {
  const c: Record<string, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) c[f.severity] = (c[f.severity] ?? 0) + 1;
  return `${c.CRITICAL} critical · ${c.WARNING} warning · ${c.SUGGESTION} suggestion`;
}

function composeBody(findings: Finding[], verdict: Verdict, title: string): string {
  const header =
    verdict === 'approve'
      ? `## ${title} — Approved ✅`
      : verdict === 'request_changes'
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

function inlineComments(findings: Finding[]): { path: string; line: number; body: string }[] {
  return findings.map((f) => ({
    path: f.file,
    line: f.end_line,
    body: `**${f.title}** (${f.severity.toLowerCase()})\n\n${f.rationale}${
      f.suggestion ? `\n\n_Suggestion:_ ${f.suggestion}` : ''
    }`,
  }));
}

export function toReviewPayload(review: Review, opts: ToReviewOptions = {}): GitHubReviewPayload {
  const inline = opts.inline ?? true;
  const title = opts.title ?? 'DevDigest Review';
  const comments = inline ? inlineComments(review.findings) : [];
  return {
    body: composeBody(review.findings, review.verdict, title),
    event: VERDICT_EVENT[review.verdict],
    ...(comments.length ? { comments } : {}),
  };
}
