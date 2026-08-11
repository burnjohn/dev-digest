import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Optionally drop low-confidence findings, filter to a severity, and sort by severity. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  sev?: Severity | null,
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (sev) shown = shown.filter((f) => f.severity === sev);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/** Per-severity counts tallied AFTER the confidence filter, so chip counts match a click. */
export function severityCounts(
  findings: FindingRecord[],
  hideLow: boolean,
): Record<Severity, number> {
  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (hideLow && f.confidence < LOW_CONFIDENCE_THRESHOLD) continue;
    if (f.severity in counts) counts[f.severity as Severity] += 1;
  }
  return counts;
}
