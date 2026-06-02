import type { FindingRow } from '../reviews/repository.js';

/** Severity tallies for a set of findings, rendered as the review summary line. */
export function severityCounts(findings: FindingRow[]): string {
  const c = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } as Record<string, number>;
  for (const f of findings) c[f.severity] = (c[f.severity] ?? 0) + 1;
  return `${c.CRITICAL} critical · ${c.WARNING} warning · ${c.SUGGESTION} suggestion`;
}
