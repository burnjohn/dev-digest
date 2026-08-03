"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { SeverityBadge, type Severity } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { SEVERITY_ORDER } from "../FindingsPanel/constants";
import { RunFindingsPopover } from "./RunFindingsPopover";
import { COUNT_DISMISSED } from "./constants";

/**
 * Sorted per-severity counts for one run's findings: hover shows the findings
 * in a popover, click opens the run's trace drawer (same path as the FileText
 * icon). Deliberately independent of RunSummary — it takes the findings
 * themselves — so it can be dropped into ReviewRunAccordion headers unchanged.
 *
 * Renders null when there is nothing to show; the caller keeps its plain-text
 * fallback so a row never goes blank.
 */
export function RunSeverityBadges({
  findings,
  onClick,
}: {
  findings: FindingRecord[];
  /** Open the run trace. When absent, the group is non-interactive. */
  onClick?: () => void;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = useState(false);

  const { counted, groups } = useMemo(() => {
    const counted = COUNT_DISMISSED ? findings : findings.filter((f) => !f.dismissed_at);
    const bySeverity = new Map<Severity, number>();
    for (const f of counted) bySeverity.set(f.severity, (bySeverity.get(f.severity) ?? 0) + 1);
    const groups = [...bySeverity.entries()].sort(
      (a, b) => (SEVERITY_ORDER[a[0]] ?? 99) - (SEVERITY_ORDER[b[0]] ?? 99),
    );
    const sorted = [...counted].sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99) ||
        b.confidence - a.confidence,
    );
    return { counted: sorted, groups };
  }, [findings]);

  if (groups.length === 0) return null;

  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={t("timeline.severityBadgesLabel")}
        title={onClick ? t("timeline.severityBadgesLabel") : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => {
          setOpen(false);
          onClick?.();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          padding: 0,
          cursor: onClick ? "pointer" : "default",
        }}
      >
        {groups.map(([severity, count]) => (
          <SeverityBadge key={severity} severity={severity} count={count} compact />
        ))}
      </button>
      {open && <RunFindingsPopover findings={counted} />}
    </span>
  );
}
