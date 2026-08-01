/**
 * Pure findings-rollup helpers shared by the two severity-counter surfaces: the
 * PR list's FINDINGS column and the Agent runs timeline.
 *
 * These MIRROR the server rule in `server/src/modules/pulls/status.ts` — the
 * list gets its counts from the API (it never loads findings), while the
 * timeline and both popovers derive theirs here from the reviews already in the
 * query cache. Change one side and you must change the other, or the same PR
 * will report two different numbers on two screens.
 */
import type { FindingRecord, ReviewRecord, Severity, SeverityCounts } from "@devdigest/shared";

/** Zero counts — what a reviewed PR with nothing to report shows. */
export function emptySeverityCounts(): SeverityCounts {
  return { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
}

/** True when a finding still counts: dismissed means resolved, so it drops out. */
function isLive(f: FindingRecord): boolean {
  return !f.dismissed_at;
}

/**
 * The findings that make up a PR's total: those of the LATEST review of EACH
 * agent.
 *
 * Two agents reviewing the same PR found different things, so both count. The
 * same agent run twice did not — its newer review supersedes its older one, and
 * counting both would inflate the number on every re-run. Reviews with no agent
 * cannot be de-duplicated that way, so each stands on its own.
 *
 * Order-independent by design: it sorts by `created_at` itself rather than
 * trusting the endpoint's ordering.
 */
export function countedFindings(reviews: ReviewRecord[]): FindingRecord[] {
  const newestFirst = [...reviews]
    .filter((r) => r.kind === "review")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  const seenAgents = new Set<string>();
  const out: FindingRecord[] = [];
  for (const review of newestFirst) {
    if (review.agent_id !== null) {
      if (seenAgents.has(review.agent_id)) continue;
      seenAgents.add(review.agent_id);
    }
    out.push(...review.findings);
  }
  return out;
}

/**
 * Tally per severity. Dismissed findings are skipped; low-confidence ones are
 * NOT — "hide low confidence" is a view toggle on the detail panel, not a
 * statement about what the review found.
 */
export function countBySeverity(findings: FindingRecord[]): SeverityCounts {
  const counts = emptySeverityCounts();
  for (const f of findings) {
    if (!isLive(f)) continue;
    if (f.severity === "CRITICAL") counts.CRITICAL += 1;
    else if (f.severity === "WARNING") counts.WARNING += 1;
    else if (f.severity === "SUGGESTION") counts.SUGGESTION += 1;
  }
  return counts;
}

/** The live findings of ONE severity — the contents of a counter's popover. */
export function findingsOfSeverity(
  findings: FindingRecord[],
  severity: Severity,
): FindingRecord[] {
  return findings.filter((f) => isLive(f) && f.severity === severity);
}

/** Total across all three buckets — drives the "no findings" zero state. */
export function totalCount(counts: SeverityCounts): number {
  return counts.CRITICAL + counts.WARNING + counts.SUGGESTION;
}

/** Format a finding's line range ("11" when single-line, else "11-15"). */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

/** Group findings by the run that produced them, for the timeline's counters. */
export function findingsByRun(reviews: ReviewRecord[]): Map<string, FindingRecord[]> {
  const map = new Map<string, FindingRecord[]>();
  for (const review of reviews) {
    if (!review.run_id) continue;
    const bucket = map.get(review.run_id);
    if (bucket) bucket.push(...review.findings);
    else map.set(review.run_id, [...review.findings]);
  }
  return map;
}
