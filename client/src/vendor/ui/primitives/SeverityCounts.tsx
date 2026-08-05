import React from "react";
import { SeverityBadge } from "./Badge";

export interface SeverityCountsValue {
  critical: number;
  warning: number;
  suggestion: number;
}

type CountedSeverity = "CRITICAL" | "WARNING" | "SUGGESTION";

const ORDER: CountedSeverity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

const KEY_OF: Record<CountedSeverity, keyof SeverityCountsValue> = {
  CRITICAL: "critical",
  WARNING: "warning",
  SUGGESTION: "suggestion",
};

/** Compact row of severity badges, one per nonzero severity, in CRITICAL→SUGGESTION order. */
export function SeverityCounts({ counts }: { counts: SeverityCountsValue }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {ORDER.filter((sev) => counts[KEY_OF[sev]] > 0).map((sev) => (
        <SeverityBadge key={sev} severity={sev} count={counts[KEY_OF[sev]]} compact />
      ))}
    </span>
  );
}
