import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Optionally drop low-confidence findings, filter by severity, and sort. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity: Severity | "all" = "all",
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (severity !== "all") shown = shown.filter((f) => f.severity === severity);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/** Count findings per severity level from the full (unfiltered) list. */
export function countBySeverity(findings: FindingRecord[]) {
  return {
    CRITICAL:   findings.filter((f) => f.severity === "CRITICAL").length,
    WARNING:    findings.filter((f) => f.severity === "WARNING").length,
    SUGGESTION: findings.filter((f) => f.severity === "SUGGESTION").length,
  };
}
