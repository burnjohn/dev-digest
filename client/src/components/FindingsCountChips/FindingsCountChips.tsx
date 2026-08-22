/* FindingsCountChips — inline per-severity count chips (icon + number), shown
   on the PR list FINDINGS column and on each Agent-runs timeline row. Renders
   only the severities that are present (count > 0), in CRITICAL→WARNING→
   SUGGESTION order; renders nothing when all are zero (callers own the "—"
   fallback). Reuses the SEV token map so colors/icons match every other
   findings surface. */
import React from "react";
import { Icon, SEV } from "@devdigest/ui";

/** The three severities surfaced as count chips (Finding has no INFO level). */
type TrackedSeverity = "CRITICAL" | "WARNING" | "SUGGESTION";

export type SeverityCounts = Record<TrackedSeverity, number>;

/** Severity display order (highest severity first). */
const ORDER: TrackedSeverity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

export function FindingsCountChips({
  counts,
  size = 14,
}: {
  counts: SeverityCounts;
  /** Icon px size; the number scales with it. Default 14 (PR list / timeline). */
  size?: number;
}) {
  const present = ORDER.filter((sev) => (counts[sev] ?? 0) > 0);
  if (present.length === 0) return null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
      {present.map((sev) => {
        const meta = SEV[sev];
        const I = Icon[meta.icon];
        return (
          <span
            key={sev}
            title={`${counts[sev]} ${meta.label.toLowerCase()}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: meta.c,
              fontSize: Math.round(size * 0.93),
              fontWeight: 600,
            }}
          >
            <I size={size} />
            <span className="tnum">{counts[sev]}</span>
          </span>
        );
      })}
    </span>
  );
}
