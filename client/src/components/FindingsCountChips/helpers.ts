import type { SeverityCounts } from "./FindingsCountChips";

/** Group findings into per-severity counts. Unknown severities are ignored. */
export function countBySeverity(
  findings: ReadonlyArray<{ severity: string }>,
): SeverityCounts {
  const counts: SeverityCounts = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (f.severity === "CRITICAL" || f.severity === "WARNING" || f.severity === "SUGGESTION") {
      counts[f.severity] += 1;
    }
  }
  return counts;
}

/** Total across the three tracked severities. */
export function totalCount(counts: SeverityCounts): number {
  return counts.CRITICAL + counts.WARNING + counts.SUGGESTION;
}
