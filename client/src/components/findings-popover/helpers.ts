import type { FindingRecord } from "@devdigest/shared";

const SEVERITY_ORDER: Record<FindingRecord["severity"], number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** Drop dismissed findings — the popover mirrors the live severity counts, not a snapshot. */
export function liveFindings(findings: FindingRecord[]): FindingRecord[] {
  return findings.filter((f) => !f.dismissed_at);
}

/** Severity (CRITICAL→WARNING→SUGGESTION) first, then confidence descending within a severity. */
export function sortForPopover(findings: FindingRecord[]): FindingRecord[] {
  return [...findings].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return b.confidence - a.confidence;
  });
}
