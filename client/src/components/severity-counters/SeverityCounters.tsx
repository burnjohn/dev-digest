/* SeverityCounters — the "⛔2 ⚠2 💡2" chip row shown on the PR list and on each
   run in the Agent runs timeline. Each chip is a button: clicking one opens a
   popover listing ONLY that severity's findings. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { SeverityBadge } from "@devdigest/ui";
// The contract enum, not @devdigest/ui's token type — that one carries a fourth
// `INFO` entry the API never produces, and SeverityCounts has no bucket for it.
import type { FindingRecord, Severity, SeverityCounts } from "@devdigest/shared";
import { findingsOfSeverity, totalCount } from "@/lib/findings";
import { FindingsPopover } from "@/components/findings-popover";

/** Display order — worst first, matching the findings panel's sort. */
const ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Gap between the chip and its popover. */
const OFFSET = 6;
/** Keep the panel this far from the viewport edge. */
const MARGIN = 8;

const wrapStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const chipButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  display: "inline-flex",
  borderRadius: 5,
};

const mutedStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
};

export function SeverityCounters({
  counts,
  findings,
  loading,
  scope,
  onOpenChange,
  repoFullName,
  headSha,
}: {
  /** Null when the PR has never been reviewed — renders a dash, not zeros. */
  counts: SeverityCounts | null | undefined;
  /** Findings backing the popover. May arrive after open (see `onOpenChange`). */
  findings?: FindingRecord[];
  /** Findings are still loading for an open popover. */
  loading?: boolean;
  scope: "pr" | "run";
  /** Fired when a popover opens or closes — the PR list uses it to fetch
      findings lazily, so the list itself stays one request. */
  onOpenChange?: (open: boolean) => void;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState<Severity | null>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const close = React.useCallback(() => {
    setOpen(null);
    setPos(null);
  }, []);

  // Report open/close upward so a parent can start fetching on demand.
  React.useEffect(() => {
    onOpenChange?.(open !== null);
  }, [open, onOpenChange]);

  // Dismiss on outside click and on Escape. The panel is portalled out of the
  // wrapper, so "outside" has to check both nodes.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // The PR table clips its children (rounded corners), so the panel is
  // portalled to <body> and positioned from the chip's rect. Reposition on
  // scroll/resize rather than closing — a table row moving under the cursor
  // should not feel like a dismissal.
  const place = React.useCallback((anchor: HTMLElement | null) => {
    const el = anchor ?? wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 0;
    const panelWidth = panelRef.current?.offsetWidth ?? 0;
    const below = rect.bottom + OFFSET;
    // Flip above the chip when the panel would run off the bottom.
    const top =
      panelHeight > 0 && below + panelHeight > window.innerHeight - MARGIN
        ? Math.max(MARGIN, rect.top - OFFSET - panelHeight)
        : below;
    const maxLeft = window.innerWidth - panelWidth - MARGIN;
    const left = panelWidth > 0 ? Math.max(MARGIN, Math.min(rect.left, maxLeft)) : rect.left;
    setPos({ top, left });
  }, []);

  // Measure once the panel exists, then keep it pinned to the chip.
  React.useLayoutEffect(() => {
    if (!open) return;
    place(null);
    const onMove = () => place(null);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  if (!counts) return <span style={mutedStyle}>—</span>;

  const total = totalCount(counts);
  if (total === 0) return <span style={mutedStyle}>{t("findingsPopover.none")}</span>;

  const visible = ORDER.filter((sev) => counts[sev] > 0);

  return (
    <div ref={wrapRef} style={wrapStyle}>
      {visible.map((sev) => (
        <button
          key={sev}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open === sev}
          aria-label={t("aria.severityChip", {
            count: counts[sev],
            severity: t(`severity.${sev}`),
          })}
          onClick={(e) => {
            // The whole PR row is a navigation target — opening a counter must
            // not also open the PR.
            e.stopPropagation();
            setOpen((cur) => (cur === sev ? null : sev));
          }}
          style={chipButtonStyle}
        >
          <SeverityBadge severity={sev} count={counts[sev]} compact />
        </button>
      ))}

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              zIndex: 60,
              // Hidden until measured, so it never flashes in the wrong spot.
              visibility: pos ? "visible" : "hidden",
            }}
          >
            <FindingsPopover
              severity={open}
              findings={findingsOfSeverity(findings ?? [], open)}
              loading={loading}
              scope={scope}
              repoFullName={repoFullName}
              headSha={headSha}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

export default SeverityCounters;
