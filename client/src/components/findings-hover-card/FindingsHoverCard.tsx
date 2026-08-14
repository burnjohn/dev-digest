/* FindingsHoverCard — read-only preview of a set of findings, shown on hover
   over a severity-badge cluster. Used from two places: the PR timeline (one
   run's findings, with `onSelect` to jump to the accordion below) and the PR
   list's FINDINGS column (the latest review's findings, no `onSelect`).

   Reuses the same presentational primitives as FindingCard (SeverityBadge,
   CategoryTag, MonoLink, ConfidenceNum) but has no accept/dismiss actions.

   The i18n keys stay under `prReview.timeline.*` even though this now lives
   outside that route: next-intl merges every messages/en/*.json into one global
   map, so the namespace costs nothing to keep and renaming it would churn
   RunHistory for no user-visible gain. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge, CategoryTag, ConfidenceNum, MonoLink, type Severity, type Category } from "@devdigest/ui";
import type { PrListFinding } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

const SEV_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

/** Fixed width of the card. Callers that position it themselves need this to
    clamp it inside the viewport. */
export const FINDINGS_HOVER_CARD_WIDTH = 380;

function lineLabel(f: Pick<PrListFinding, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}

export function FindingsHoverCard({
  findings,
  repoFullName,
  headSha,
  onSelect,
}: {
  /* `PrListFinding` is the minimal shape this renders; `FindingRecord` is
     structurally a superset, so the timeline keeps passing its own rows. */
  findings: PrListFinding[];
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
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        left: 0,
        width: FINDINGS_HOVER_CARD_WIDTH,
        maxHeight: 420,
        overflowY: "auto",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 10,
        boxShadow: "var(--shadow-modal)",
        zIndex: 50,
        textAlign: "left",
      }}
    >
      {/* The click handler is containment, not an interaction: it keeps a click
          inside the card from reaching the PR list row underneath, which would
          navigate away. `presentation` states that — the card stays
          `role="tooltip"` (FindingsCell measures it by that role and positions
          its parent wrapper), and this filler carries the card's padding so the
          whole surface, not just the text, swallows the click. */}
      <div role="presentation" onClick={(e) => e.stopPropagation()} style={{ padding: 14 }}>
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
    </div>
  );
}
