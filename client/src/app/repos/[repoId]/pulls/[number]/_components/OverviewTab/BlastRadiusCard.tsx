"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Icon } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import type { BlastRadius, PrHistory, BlastLink, BlastIndexInfo } from "@devdigest/shared";
import { SymbolImpact } from "./SymbolImpact";
import { s } from "./styles";

/** Deterministic avatar color per author (design sample: colored initial dots). */
const AVATAR_PALETTE = ["#ef4444", "#22c55e", "#f59e0b", "#3b82f6", "#a855f7", "#14b8a6"];
function avatarColor(author: string): string {
  let hash = 0;
  for (let i = 0; i < author.length; i += 1) hash = (hash * 31 + author.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
}

/** Notes with `backtick` segments rendered as inline-code chips (design sample). */
function NotesText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <div style={s.priorPrNotes}>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} style={s.inlineCode}>{p.slice(1, -1)}</code>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </div>
  );
}

// Dynamic import keeps React Flow out of the initial bundle (ssr: false required for canvas APIs)
const BlastGraph = dynamic(() => import("./BlastGraph").then((m) => ({ default: m.BlastGraph })), {
  ssr: false,
});

interface BlastRadiusCardProps {
  blast: BlastRadius;
  history: PrHistory;
  /** When present, enables clickable GitHub blob URLs on caller file:line refs. */
  link?: BlastLink | null;
  /** Index state for the degraded badge — omit when rendering from seed brief. */
  index?: BlastIndexInfo;
  /** Per-symbol truncated caller count ("+N more" rows). Key = symbol name. */
  truncated?: Record<string, number>;
  /** cron value → declaring file(s), for labelling cron badges by file name. */
  cronFiles?: Record<string, string[]>;
}

export function BlastRadiusCard({
  blast,
  history,
  link,
  index,
  truncated,
  cronFiles,
}: BlastRadiusCardProps) {
  const t = useTranslations("blast");
  const [priorOpen, setPriorOpen] = React.useState(false);
  const [view, setView] = React.useState<"tree" | "graph">("tree");

  const priorCount = history.history.length;

  // Show only symbols that reach an HTTP endpoint or cron — the API-relevant
  // blast surface (matches the design density). Symbols whose impact is purely
  // internal (callers only, no route/cron) are omitted.
  const visibleDownstream = blast.downstream.filter(
    (d) => d.endpoints_affected.length + d.crons_affected.length > 0,
  );
  const visibleSymbolNames = new Set(visibleDownstream.map((d) => d.symbol));
  const visibleSymbols = blast.changed_symbols.filter((cs) => visibleSymbolNames.has(cs.name));
  const visibleBlast: BlastRadius = {
    ...blast,
    changed_symbols: visibleSymbols,
    downstream: visibleDownstream,
  };

  // Header stats mirror the GRAPH exactly: one node per distinct symbol,
  // caller (by name — same dedup the graph uses), endpoint, and cron. A single
  // caller reaching several changed symbols is ONE caller, not N.
  const totalCallers = new Set(visibleDownstream.flatMap((d) => d.callers.map((c) => c.name))).size;
  const totalEndpoints = new Set(visibleDownstream.flatMap((d) => d.endpoints_affected)).size;
  const totalCrons = new Set(visibleDownstream.flatMap((d) => d.crons_affected)).size;

  // Degraded badge: show when live index is present and is partial or degraded
  const showDegradedBadge = index && (index.degraded || index.status === "partial");
  const degradedReason = index?.reason
    ? index.reason
    : index?.status === "partial"
      ? t("degraded.partial")
      : t("degraded.noIndex");

  return (
    <div style={s.card}>
      <div style={s.cardHeader}>
        <Icon.Zap size={12} />
        {t("header")}
        {showDegradedBadge && (
          <span
            style={s.degradedBadge}
            title={degradedReason}
            role="status"
            aria-label={`${t("degraded.badge")}: ${degradedReason}`}
          >
            <Icon.AlertTriangle size={9} />
            {t("degraded.badge")}
          </span>
        )}
      </div>
      <div style={s.cardBody}>
        {/* Stats row */}
        <div style={s.statsRow}>
          <span style={s.statItem}>
            <Icon.Code size={12} />
            <span style={s.statCount}>{visibleDownstream.length}</span> {t("stat.symbols")}
          </span>
          <span style={s.statItem}>
            <Icon.ArrowRight size={12} />
            <span style={s.statCount}>{totalCallers}</span> {t("stat.callers")}
          </span>
          <span style={s.statItem}>
            <Icon.Globe size={12} />
            <span style={s.statCount}>{totalEndpoints}</span> {t("stat.endpoints")}
          </span>
          <span style={s.statItem}>
            <Icon.Clock size={12} />
            <span style={s.statCount}>{totalCrons}</span> {t("stat.crons")}
          </span>
          <span style={s.toggleRow}>
            <button
              type="button"
              style={s.toggleBtn(view === "tree")}
              onClick={() => setView("tree")}
            >
              {t("view.tree")}
            </button>
            <button
              type="button"
              style={s.toggleBtn(view === "graph")}
              onClick={() => setView("graph")}
            >
              {t("view.graph")}
            </button>
          </span>
        </div>

        {/* Symbol tree / Graph view */}
        {view === "tree" ? (
          <div style={s.treeWrap}>
            {visibleDownstream.map((impact) => (
              <SymbolImpact
                key={impact.symbol}
                impact={impact}
                link={link}
                truncatedCount={truncated?.[impact.symbol]}
                cronFiles={cronFiles}
              />
            ))}
            {visibleDownstream.length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>
                {t("noImpact", { count: blast.downstream.length })}
              </div>
            )}
          </div>
        ) : (
          <BlastGraph blast={visibleBlast} link={link} cronFiles={cronFiles} />
        )}

        {/* Prior PRs collapsible */}
        {priorCount > 0 && (
          <div>
            <button
              type="button"
              style={s.priorPrsToggle}
              aria-expanded={priorOpen}
              onClick={() => setPriorOpen((o) => !o)}
            >
              <Icon.GitPullRequest size={12} />
              {t("priorPrs")}
              <span
                style={{
                  marginLeft: 4,
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "0 6px",
                  fontSize: 11,
                }}
              >
                {priorCount}
              </span>
              <Icon.ChevronDown
                size={12}
                style={{
                  marginLeft: "auto",
                  transform: priorOpen ? "rotate(180deg)" : "none",
                  transition: "transform .15s",
                }}
              />
            </button>
            {priorOpen &&
              history.history.map((h, i) => (
                <div key={i} style={s.priorPrItem}>
                  <div style={s.priorPrTitleRow}>
                    <span style={s.priorPrBullet} aria-hidden="true" />
                    <span style={s.priorPrNumber}>#{h.pr_number}</span>
                    <span style={s.priorPrTitle}>{h.title}</span>
                  </div>
                  <div style={s.priorPrMeta}>
                    <span style={s.priorPrAvatar(avatarColor(h.author))} aria-hidden="true">
                      {h.author.charAt(0)}
                    </span>
                    <span>{h.author}</span>
                    <span>·</span>
                    {/* Design sample: bare ISO date, "merged" only as a tooltip. */}
                    <span title={t("merged")}>{h.merged_at.slice(0, 10)}</span>
                  </div>
                  {h.notes && <NotesText text={h.notes} />}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
