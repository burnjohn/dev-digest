/**
 * A3 — pure helpers for the brief + git-why services (extracted from service.ts
 * / why.ts; no behaviour change). Side-effect free; operate purely on arguments.
 */
import type { Intent, Risks, UnifiedDiff } from '@devdigest/shared';
import type { WhyEvent } from '@devdigest/shared/contracts/why';
import {
  LARGE_DIFF_LINES,
  MIGRATION_RE,
  PR_NUM_RE,
  SECRET_RE,
} from './constants.js';

/** Extract a PR number from a commit message, or null when none is present. */
export function parsePr(message: string): number | null {
  const m = message.match(PR_NUM_RE);
  if (!m) return null;
  const n = m[1] ?? m[2] ?? m[3];
  return n ? Number(n) : null;
}

/** Stub Intent used when a PR has no persisted intent yet. */
export function stubIntent(title: string): Intent {
  return { intent: `Changes for: ${title}`, in_scope: [], out_of_scope: [] };
}

/** Heuristic fallback so the brief always has a Risks block (no LLM key / failure). */
export function heuristicRisks(diff: UnifiedDiff): Risks {
  const risks: Risks['risks'] = [];
  const added = diff.raw
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .join('\n');
  const touched = diff.files.map((f) => f.path);
  if (SECRET_RE.test(added)) {
    risks.push({
      kind: 'security',
      title: 'Possible secret or credential in the diff',
      explanation:
        'The added lines contain a pattern that looks like a hard-coded secret/API key. Verify it is not a real credential before merging.',
      severity: 'high',
      file_refs: touched,
    });
  }
  if (diff.files.some((f) => MIGRATION_RE.test(f.path))) {
    risks.push({
      kind: 'data-migration',
      title: 'Schema / migration change',
      explanation:
        'This PR touches schema or migration files. Confirm the migration is backwards-compatible and has a rollback path.',
      severity: 'medium',
      file_refs: touched.filter((p) => MIGRATION_RE.test(p)),
    });
  }
  const totalLines = diff.files.reduce((n, f) => n + f.additions + f.deletions, 0);
  if (totalLines > LARGE_DIFF_LINES) {
    risks.push({
      kind: 'reviewability',
      title: 'Large diff is hard to review safely',
      explanation: `This PR changes ${totalLines} lines across ${diff.files.length} files. Consider splitting it so each piece can be reviewed in isolation.`,
      severity: 'low',
      file_refs: touched,
    });
  }
  return { risks };
}

/** Compose the one-line git-why summary for a file:line. */
export function summarizeWhy(
  file: string,
  line: number,
  blame: WhyEvent | null,
  events: WhyEvent[],
): string {
  if (!blame && events.length === 0) {
    return `No git history available for ${file}:${line} — the repo may not be cloned yet.`;
  }
  const head = blame ?? events[0]!;
  const pr = head.pr_number ? ` (PR #${head.pr_number})` : '';
  const total = events.length || (blame ? 1 : 0);
  return `${file}:${line} was last shaped by "${head.summary}" by ${head.author}${pr}; ${total} commit(s) in its history.`;
}
