/* PRRow — one clickable row in the PR list table. Ported from screen_dashboard.jsx. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, CircularScore } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import type { PrMeta as PrMetaType } from "@/lib/types";
import { SIZE_COLOR, STATUS_META } from "../../constants";
import { relativeTime, sizeOf } from "../../helpers";
import { formatCost } from "@/lib/format";
import { s } from "../../styles";
import { usePrReviews } from "@/lib/hooks/reviews";
import { RunReviewDropdown } from "@/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown";

// ---- Severity display config ------------------------------------------------

const SEV_COLS = [
  { key: "critical" as const, color: "var(--crit)", Icon: Icon.AlertOctagon },
  { key: "warning" as const, color: "var(--warn)", Icon: Icon.AlertTriangle },
  { key: "suggestion" as const, color: "var(--sugg)", Icon: Icon.Lightbulb },
];

const SEV_ORDER: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

// ---- Findings popup ---------------------------------------------------------

function FindingsPopup({
  prId,
  top,
  left,
  onClose,
}: {
  prId: string;
  top: number;
  left: number;
  onClose: () => void;
}) {
  const { data: reviews, isLoading } = usePrReviews(prId);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Viewport overflow correction (horizontal). Deferred to rAF so the browser
  // has performed layout and offsetWidth is non-zero on the first read.
  const [adjustedLeft, setAdjustedLeft] = React.useState(left);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (!ref.current) return;
      const overflow = left + ref.current.offsetWidth - window.innerWidth + 12;
      setAdjustedLeft(overflow > 0 ? left - overflow : left);
    });
    return () => cancelAnimationFrame(id);
  }, [left]);

  // Show findings from the LATEST review only — matches the FINDINGS column badge counts.
  // Flattening all reviews would inflate the count vs what the badge displays.
  const findings: FindingRecord[] = React.useMemo(() => {
    if (!reviews || reviews.length === 0) return [];
    const latest = reviews[0]!;
    return [...latest.findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  }, [reviews]);

  const total = findings.length;

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top,
        left: adjustedLeft,
        zIndex: 1200,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        minWidth: 340,
        maxWidth: 420,
        maxHeight: 420,
        overflowY: "auto",
        boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
        }}
      >
        {isLoading ? "Loading…" : `${total} finding${total !== 1 ? "s" : ""}`}
      </div>

      {!isLoading && findings.length === 0 && (
        <div style={{ padding: "14px", fontSize: 13, color: "var(--text-muted)" }}>
          No findings
        </div>
      )}

      {findings.map((f, i) => {
        const sevColor =
          f.severity === "CRITICAL"
            ? "var(--crit)"
            : f.severity === "WARNING"
              ? "var(--warn)"
              : "var(--sugg)";
        const SevIcon =
          f.severity === "CRITICAL"
            ? Icon.AlertOctagon
            : f.severity === "WARNING"
              ? Icon.AlertTriangle
              : Icon.Lightbulb;

        return (
          <div
            key={f.id}
            style={{
              padding: "11px 14px",
              borderBottom: i < findings.length - 1 ? "1px solid var(--border)" : "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <SevIcon size={13} style={{ color: sevColor, flexShrink: 0, marginTop: 2 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
                  {f.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      border: "1px solid var(--border)",
                      borderRadius: 3,
                      padding: "1px 5px",
                    }}
                  >
                    {f.category}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {f.file}:{f.start_line}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {Math.round(f.confidence * 100)}% conf
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    marginTop: 5,
                    lineHeight: 1.5,
                  }}
                >
                  {f.rationale.length > 160 ? f.rationale.slice(0, 157) + "…" : f.rationale}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- PRRow ------------------------------------------------------------------

export function PRRow({ pr, repoId }: { pr: PrMetaType; repoId: string }) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const [h, setH] = React.useState(false);
  const [popup, setPopup] = React.useState<{ top: number; left: number } | null>(null);

  const st = STATUS_META[pr.status] ?? STATUS_META.needs_review!;
  const { size, lines } = sizeOf(pr);
  const reviewed = pr.score != null;
  const bd = pr.findings_breakdown ?? null;
  const hasFindings = bd && (bd.critical + bd.warning + bd.suggestion) > 0;

  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      onClick={() => router.push(`/repos/${repoId}/pulls/${pr.number}`)}
      style={s.row(h)}
    >
      <div style={s.rowTitleCell}>
        <Icon.GitPullRequest size={15} style={s.rowIcon(st.c)} />
        <div style={s.rowTitleWrap}>
          <div style={s.rowTitle(h)}>{pr.title}</div>
          <span className="mono" style={s.rowNumber}>
            #{pr.number}
          </span>
        </div>
      </div>

      <div style={s.authorCell}>
        <Avatar name={pr.author} size={18} />
        {pr.author}
      </div>

      <div>
        <Badge
          color={SIZE_COLOR[size]}
          bg="transparent"
          style={s.sizeBadgeBorder(SIZE_COLOR[size]!)}
        >
          {size} · {lines}
        </Badge>
      </div>

      <div style={s.scoreCell}>
        {reviewed ? (
          <CircularScore score={pr.score!} size={34} stroke={3} />
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>

      {/* FINDINGS — all three severity types always shown; 0-counts dimmed */}
      <div
        role={hasFindings ? "button" : undefined}
        onClick={
          hasFindings && pr.id
            ? (e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setPopup((p) =>
                  p ? null : { top: rect.bottom + 4, left: rect.left },
                );
              }
            : undefined
        }
        style={hasFindings ? s.findingsCell : undefined}
      >
        {hasFindings ? (
          SEV_COLS.map(({ key, color, Icon: SevIcon }) => {
            const cnt = bd![key];
            return (
              <span
                key={key}
                style={{
                  ...s.findingsBadge(color),
                  opacity: cnt > 0 ? 1 : 0.45,
                }}
              >
                <SevIcon size={11} />
                {cnt}
              </span>
            );
          })
        ) : (
          <span style={s.muted}>—</span>
        )}
      </div>

      <div>
        <Badge dot color={st.c} bg="transparent">
          {t(`list.status.${st.labelKey}`)}
        </Badge>
      </div>

      <div style={s.costCell}>{formatCost(pr.cost_usd)}</div>

      {/* Actions — always-visible Run Review button in its own column */}
      <div onClick={(e) => e.stopPropagation()}>
        {pr.id && <RunReviewDropdown prId={pr.id} size="sm" kind="secondary" />}
      </div>

      <div style={s.updatedCell}>{relativeTime(pr.updated_at)}</div>

      {popup && pr.id && createPortal(
        <FindingsPopup
          prId={pr.id}
          top={popup.top}
          left={popup.left}
          onClose={() => setPopup(null)}
        />,
        document.body,
      )}
    </div>
  );
}
