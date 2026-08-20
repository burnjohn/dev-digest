/* RunFindingsHoverCard — read-only preview of a run's findings, shown on
   hover over the severity-badge cluster in the Timeline. Reuses the same
   presentational primitives as FindingCard (SeverityBadge, CategoryTag,
   MonoLink, ConfidenceNum) but has no accept/dismiss actions of its own —
   the deep-dive happens in the accordion below via `onSelect`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum, MonoLink, type Severity, type Category } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";

const SEV_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

export function RunFindingsHoverCard({
  findings,
  repoFullName,
  headSha,
  onSelect,
}: {
  findings: FindingRecord[];
  repoFullName?: string | null;
  headSha?: string | null;
  /** Jump to this run's full findings in the accordion below. */
  onSelect?: () => void;
}) {
  const t = useTranslations("prReview");
  const sorted = React.useMemo(
    () =>
      [...findings].sort(
        (a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) || b.confidence - a.confidence,
      ),
    [findings],
  );

  return (
    <div
      role="tooltip"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        left: 0,
        width: 380,
        maxHeight: 420,
        overflowY: "auto",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
        boxShadow: "var(--shadow-modal)",
        padding: 14,
        zIndex: 50,
        textAlign: "left",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
          marginBottom: 10,
        }}
      >
        <Icon.Info size={13} />
        {t("timeline.findingsHoverTitle", { count: sorted.length })}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {sorted.map((f, i) => {
          const fileHref =
            repoFullName && headSha
              ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
              : undefined;
          return (
            <div key={f.id} style={{ padding: "10px 0", borderTop: i === 0 ? "none" : "1px dashed var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <SeverityBadge severity={f.severity as Severity} compact />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.title}
                </span>
                <CategoryTag category={f.category as Category} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <MonoLink href={fileHref}>
                  {f.file}:{lineLabel(f)}
                </MonoLink>
                <ConfidenceNum value={f.confidence} />
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {f.rationale}
              </div>
            </div>
          );
        })}
      </div>

      {onSelect && (
        <button
          type="button"
          onClick={onSelect}
          style={{
            marginTop: 4,
            background: "none",
            border: "none",
            padding: 0,
            fontSize: 12,
            color: "var(--accent-text)",
            cursor: "pointer",
            textDecoration: "underline",
            textDecorationStyle: "dotted",
            textUnderlineOffset: 3,
          }}
        >
          {t("timeline.goToReview")}
        </button>
      )}
    </div>
  );
}
