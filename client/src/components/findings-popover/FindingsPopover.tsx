/* FindingsPopover — the panel a severity counter opens. Lists ONLY the findings
   of the severity that was clicked, so "⚠ 2" and the panel below it always
   agree. Presentational: it receives the findings it should show. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Skeleton,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { lineLabel } from "@/lib/findings";
import { githubBlobUrl } from "@/lib/github-urls";

/** Rows shown before collapsing the rest into a "+N more" footer. */
export const MAX_ROWS = 8;

const panelStyle: React.CSSProperties = {
  width: 380,
  maxWidth: "min(380px, calc(100vw - 32px))",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-strong)",
  borderRadius: 9,
  boxShadow: "var(--shadow-modal)",
  padding: 12,
  textAlign: "left",
  cursor: "default",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  paddingBottom: 10,
  marginBottom: 4,
  borderBottom: "1px solid var(--border)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "10px 0",
  borderTop: "1px solid var(--border)",
};

const titleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const metaRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

// Two lines of rationale is enough to tell findings apart without turning the
// popover into a wall of text — the full text lives on the finding card.
const rationaleStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--text-secondary)",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const footerStyle: React.CSSProperties = {
  paddingTop: 10,
  borderTop: "1px solid var(--border)",
  fontSize: 12,
  color: "var(--text-muted)",
};

export function FindingsPopover({
  severity,
  findings,
  loading,
  scope,
  repoFullName,
  headSha,
}: {
  severity: Severity;
  findings: FindingRecord[];
  /** Findings are still being fetched (the PR list loads them on open). */
  loading?: boolean;
  /** Wording of the header: a whole PR's findings, or one run's. */
  scope: "pr" | "run";
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const shown = findings.slice(0, MAX_ROWS);
  const overflow = findings.length - shown.length;
  const severityLabel = t(`severity.${severity}`);

  return (
    <div style={panelStyle} role="dialog" aria-label={severityLabel}>
      <div style={headerStyle}>
        <SeverityBadge severity={severity} compact />
        <span>
          {loading
            ? t("findingsPopover.loading")
            : t(scope === "run" ? "findingsPopover.titleInRun" : "findingsPopover.titleForPr", {
                count: findings.length,
                severity: severityLabel,
              })}
        </span>
      </div>

      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 10 }}>
          <Skeleton height={14} />
          <Skeleton height={14} width="70%" />
        </div>
      )}

      {!loading && findings.length === 0 && (
        <div style={{ ...footerStyle, borderTop: "none" }}>{t("findingsPopover.empty")}</div>
      )}

      {!loading &&
        shown.map((f) => (
          <div key={f.id} style={rowStyle}>
            <div style={titleRowStyle}>
              <span style={titleStyle}>{f.title}</span>
              <CategoryTag category={f.category as Category} />
            </div>
            <div style={metaRowStyle}>
              <MonoLink
                href={
                  repoFullName && headSha
                    ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
                    : undefined
                }
              >
                {f.file}:{lineLabel(f)}
              </MonoLink>
              <ConfidenceNum value={f.confidence} />
            </div>
            <div style={rationaleStyle}>{f.rationale}</div>
          </div>
        ))}

      {overflow > 0 && (
        <div style={footerStyle}>{t("findingsPopover.more", { count: overflow })}</div>
      )}
    </div>
  );
}

export default FindingsPopover;
