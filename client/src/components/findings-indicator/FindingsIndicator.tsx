"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Icon,
  SEV,
} from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { lineLabel } from "@/app/repos/[repoId]/pulls/[number]/_components/FindingCard/helpers";
import { s } from "./styles";

/**
 * FindingsIndicator — a compact, clickable row of severity icons + counts with a
 * hover/click popup listing the findings (each deep-linking to GitHub). Fully
 * presentational: the caller supplies `counts` + `findings` (already filtered to
 * non-dismissed) and lazily loads the findings; this component owns no data.
 *
 * The popup is portalled to <body> with position:fixed and is a single global
 * instance that self-dismisses. Both are load-bearing (see the README/INSIGHTS):
 *  - an in-flow absolute panel is CLIPPED by the PR-list table card's
 *    overflow:hidden — the portal removes it from that containing block;
 *  - hover-open with only click-outside/Esc STACKS a popup per hovered row —
 *    the mouse-leave grace-close + module-level registry keep exactly one open.
 */

type SevKey = "CRITICAL" | "WARNING" | "SUGGESTION";
const ORDER: SevKey[] = ["CRITICAL", "WARNING", "SUGGESTION"];

interface FindingsIndicatorProps {
  counts: { CRITICAL: number; WARNING: number; SUGGESTION: number };
  /** Popup content; the caller has already filtered out dismissed findings. */
  findings: FindingRecord[];
  /** Popup shows a spinner while lazily-loaded findings arrive. */
  loading?: boolean;
  /** Popup header wording only: "N findings in this run" vs "N findings". */
  variant?: "run" | "pr";
  repoFullName?: string | null;
  headSha?: string | null;
}

type Pos = { left: number; top?: number; bottom?: number; width: number; maxHeight: number };

// Global single-instance registry — only one popup exists page-wide. Each PRRow
// and each timeline run mounts its own indicator; without this, hovering several
// rows would stack several popups.
const openPopups = new Set<() => void>();
function closeOthers(keep: () => void) {
  for (const c of openPopups) if (c !== keep) c();
}

const ARIA_KEY: Record<SevKey, string> = {
  CRITICAL: "findings.indicator.ariaCritical",
  WARNING: "findings.indicator.ariaWarning",
  SUGGESTION: "findings.indicator.ariaSuggestion",
};

export function FindingsIndicator({
  counts,
  findings,
  loading,
  variant = "pr",
  repoFullName,
  headSha,
}: FindingsIndicatorProps) {
  const t = useTranslations("prReview");
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<SevKey | "all">("all");
  const [pos, setPos] = React.useState<Pos | null>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = React.useCallback(() => setOpen(false), []);
  const cancelScheduledClose = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = React.useCallback(() => {
    cancelScheduledClose();
    // Grace delay lets the pointer cross the gap between strip and panel.
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  }, [cancelScheduledClose]);

  // Single global instance: opening one popup closes any other.
  React.useEffect(() => {
    if (!open) {
      openPopups.delete(close);
      return;
    }
    closeOthers(close);
    openPopups.add(close);
    return () => {
      openPopups.delete(close);
    };
  }, [open, close]);

  // Position the portalled panel under (or above) the strip; recompute on
  // scroll (capture: ancestor scroll) + resize while open.
  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const recompute = () => {
      const el = stripRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const margin = 8;
      const GAP = 6;
      const WIDTH = 420;
      const MIN_H = 220;
      const width = Math.min(WIDTH, window.innerWidth - margin * 2);
      const left = Math.min(Math.max(r.left, margin), window.innerWidth - width - margin);
      const below = window.innerHeight - r.bottom - margin;
      const above = r.top - margin;
      if (below >= MIN_H || below >= above) {
        setPos({ left, top: r.bottom + GAP, width, maxHeight: Math.max(below, MIN_H) });
      } else {
        setPos({ left, bottom: window.innerHeight - r.top + GAP, width, maxHeight: above });
      }
    };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  // Close on click-outside (checking BOTH refs — the portalled panel is not a
  // DOM descendant of the strip) + Esc.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (stripRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Clear any pending close on unmount.
  React.useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  const total = counts.CRITICAL + counts.WARNING + counts.SUGGESTION;
  if (total === 0) return null;

  const present = ORDER.filter((sev) => counts[sev] > 0);

  const openFresh = () => {
    cancelScheduledClose();
    if (!open) setFilter("all"); // reset ONLY when opening fresh; preserve a picked filter on re-entry
    setOpen(true);
  };
  const openWithFilter = (sev: SevKey) => {
    cancelScheduledClose();
    setFilter(sev);
    setOpen(true);
  };

  const visible = filter === "all" ? findings : findings.filter((f) => f.severity === filter);
  const header =
    variant === "run"
      ? t("findings.indicator.headerRun", { count: total })
      : t("findings.indicator.headerPr", { count: total });
  const canLink = !!repoFullName && !!headSha;

  const panel = pos ? (
    <div
      ref={popupRef}
      role="dialog"
      aria-label={header}
      onMouseEnter={cancelScheduledClose}
      onMouseLeave={scheduleClose}
      style={{
        ...s.panel,
        position: "fixed",
        left: pos.left,
        top: pos.top,
        bottom: pos.bottom,
        width: pos.width,
        maxHeight: pos.maxHeight,
      }}
    >
      <div style={s.panelHeader}>
        <span style={s.headerCount}>{header}</span>
      </div>
      <div style={s.chips}>
        <button type="button" style={s.chip(filter === "all")} onClick={() => setFilter("all")}>
          {t("findings.indicator.all")}
        </button>
        {present.map((sev) => {
          const SevIcon = Icon[SEV[sev].icon];
          return (
            <button
              key={sev}
              type="button"
              style={s.chip(filter === sev)}
              onClick={() => setFilter(sev)}
            >
              <SevIcon size={12} style={{ color: SEV[sev].c }} />
              <span style={s.srOnly}>{t(`findings.indicator.sev.${sev}`)}</span>
              {counts[sev]}
            </button>
          );
        })}
      </div>
      {loading ? (
        <div style={s.loadingRow}>
          <Icon.RefreshCw size={14} style={{ animation: "ddspin 1s linear infinite" }} />
          {t("findings.indicator.loading")}
        </div>
      ) : visible.length === 0 ? (
        <div style={s.emptyRow}>{t("findings.indicator.empty")}</div>
      ) : (
        <div style={s.list}>
          {visible.map((f) => (
            <div key={f.id} style={s.row}>
              <SeverityBadge severity={f.severity} compact />
              <span style={s.rowTitle}>{f.title}</span>
              <CategoryTag category={f.category} />
              {canLink ? (
                <MonoLink href={githubBlobUrl(repoFullName!, headSha!, f.file, f.start_line, f.end_line)}>
                  {f.file}:{lineLabel(f)}
                </MonoLink>
              ) : (
                <span className="mono" style={s.muted}>
                  {f.file}:{lineLabel(f)}
                </span>
              )}
              <ConfidenceNum value={f.confidence} />
              {f.rationale ? <span style={s.rationale}>{f.rationale}</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div
      ref={stripRef}
      style={s.strip}
      onMouseEnter={openFresh}
      onMouseLeave={scheduleClose}
      onClick={(e) => e.stopPropagation()}
    >
      {present.map((sev) => (
        <button
          key={sev}
          type="button"
          aria-label={t(ARIA_KEY[sev], { count: counts[sev] })}
          style={s.iconButton}
          onClick={(e) => {
            e.stopPropagation();
            openWithFilter(sev);
          }}
        >
          <SeverityBadge severity={sev} count={counts[sev]} compact />
        </button>
      ))}
      {open && typeof document !== "undefined" && createPortal(panel, document.body)}
    </div>
  );
}
