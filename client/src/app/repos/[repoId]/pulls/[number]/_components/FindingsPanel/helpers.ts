import type { FindingRecord } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Count findings per severity. */
export function countBySeverity(findings: FindingRecord[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});
}

/** Filter (by enabled severities + optional low-confidence cut) and sort by severity. */
export function visibleFindings(
  findings: FindingRecord[],
  sevFilter: Record<string, boolean>,
  hideLow: boolean,
): FindingRecord[] {
  let shown = findings.filter((f) => sevFilter[f.severity]);
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
