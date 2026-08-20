/* FindingsPreviewCard — hover popover listing findings (severity, title,
   category, file:line, confidence, truncated rationale). Shared by the PR
   list's FINDINGS column and the PR detail timeline. */
"use client";

import React from "react";
import { Icon, SeverityBadge, CategoryTag, type Severity, type Category } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { s } from "./styles";

/** Display order for severity chips and preview sorting. */
export const PREVIEW_SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;

/** Findings sorted CRITICAL → WARNING → SUGGESTION (unknown severities last). */
export function sortBySeverity(findings: FindingRecord[]): FindingRecord[] {
  const rank = (sev: string) => {
    const i = PREVIEW_SEVERITIES.indexOf(sev as (typeof PREVIEW_SEVERITIES)[number]);
    return i === -1 ? PREVIEW_SEVERITIES.length : i;
  };
  return [...findings].sort((a, b) => rank(a.severity) - rank(b.severity));
}

export function FindingsPreviewCard({
  findings,
  title,
  top,
  left,
}: {
  findings: FindingRecord[];
  /** Translated header, e.g. "6 findings" / "2 findings in this run". */
  title: string;
  /** Viewport coordinates of the card's top-left corner. */
  top: number;
  left: number;
}) {
  return (
    <div style={s.card(top, left)} onClick={(e) => e.stopPropagation()}>
      <div style={s.title}>
        <Icon.AlertOctagon size={12} />
        {title}
      </div>
      {findings.map((f) => (
        <div key={f.id} style={s.item}>
          <div style={s.head}>
            <SeverityBadge severity={f.severity as Severity} compact />
            <span style={s.itemTitle}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
          </div>
          <div style={s.meta}>
            <span className="mono" style={{ color: "var(--accent)" }}>
              {f.file}:{f.start_line}
            </span>
            <span style={s.conf}>{Math.round(f.confidence * 100)}% conf</span>
          </div>
          <div style={s.rationale}>{f.rationale}</div>
        </div>
      ))}
    </div>
  );
}
