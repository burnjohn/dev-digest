import type { CSSProperties } from "react";

export const s = {
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,

  // Two-column grid for Intent + Blast Radius cards
  // alignItems defaults to "stretch" (CSS grid default) so both cells share the same height.
  // When the Blast Radius card grows (e.g. Prior PRs accordion expands), the Intent card
  // stretches to match — no JS required.
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  } satisfies CSSProperties,

  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,

  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  cardBody: {
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
  } satisfies CSSProperties,

  // Intent card
  intentQuote: {
    fontSize: 14,
    fontStyle: "italic" as const,
    color: "var(--text-primary)",
    lineHeight: 1.55,
    margin: 0,
  } satisfies CSSProperties,

  scopeSection: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  scopeHeader: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color,
    marginBottom: 2,
  }),

  scopeItem: (muted: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    fontSize: 13,
    color: muted ? "var(--text-muted)" : "var(--text-secondary)",
    lineHeight: 1.4,
  }),

  scopeBullet: {
    color: "var(--text-muted)",
    flexShrink: 0,
    lineHeight: 1.4,
  } satisfies CSSProperties,

  intentDivider: {
    borderTop: "1px solid var(--border)",
    margin: "2px 0",
  } satisfies CSSProperties,

  riskAreasHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,

  // --- Risk cards (responsive accordion grid, replaces the flat risk-row list) ---
  // auto-fit + minmax lets the grid drop from 2 columns to 1 full-width column
  // when a card would be too cramped, so long titles fit on <=2 lines instead
  // of wrapping to 4 (design sample "widen so text fits" requirement).
  riskGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 8,
  } satisfies CSSProperties,

  // `active` renders the open card's accent-color border (design sample);
  // default otherwise. Single param keeps the toggle logic in one style key.
  riskCard: (active: boolean, accentColor: string): CSSProperties => ({
    border: `1px solid ${active ? accentColor : "var(--border)"}`,
    borderRadius: 8,
    background: "var(--bg-surface)",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    cursor: "pointer",
  }),

  riskCardHeaderRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    cursor: "pointer",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  // Tinted icon chip — color/bg pairs are the SAME tokens already used for
  // severity chips elsewhere in the app (`--crit`/`--crit-bg`, `--warn`/`--warn-bg`);
  // the blue (perf) and muted (default) buckets reuse the existing rgba tints
  // already present in this file (httpBadge/inlineCode) rather than introducing new hex.
  riskIconWrap: (color: string): CSSProperties => {
    const bg =
      color === "var(--crit)"
        ? "var(--crit-bg)"
        : color === "var(--warn)"
          ? "var(--warn-bg)"
          : color === "#60a5fa"
            ? "rgba(59,130,246,0.12)"
            : "var(--bg-surface)";
    const border =
      color === "var(--crit)"
        ? "1px solid var(--crit)"
        : color === "var(--warn)"
          ? "1px solid var(--warn)"
          : color === "#60a5fa"
            ? "1px solid rgba(59,130,246,0.35)"
            : "1px solid var(--border)";
    return {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 22,
      height: 22,
      borderRadius: 6,
      flexShrink: 0,
      background: bg,
      border,
      color,
    };
  },

  riskCardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  riskChevronBox: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,

  riskCardPathLink: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 11,
    color: "#60a5fa",
    textDecoration: "none",
    paddingLeft: 30,
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left" as const,
  } satisfies CSSProperties,

  // Full-width detail panel rendered below the RISK AREAS grid for the open
  // accordion item — same bordered/tinted-surface grammar as `card`/`descriptionBox`.
  riskDetailPanel: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  // Blast Radius card
  statsRow: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  statItem: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  statCount: {
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  toggleRow: {
    marginLeft: "auto",
    display: "flex",
    gap: 4,
  } satisfies CSSProperties,

  toggleBtn: (active: boolean): CSSProperties => ({
    padding: "3px 10px",
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: active ? "var(--bg-surface)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    cursor: "pointer",
  }),

  // Symbol tree
  treeWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  } satisfies CSSProperties,

  symbolRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 0",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  symbolName: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    flex: 1,
  } satisfies CSSProperties,

  callerCount: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginLeft: "auto",
    flexShrink: 0,
  } satisfies CSSProperties,

  callerLines: {
    paddingLeft: 22,
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    marginBottom: 6,
  } satisfies CSSProperties,

  callerLine: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,

  // Endpoint capsule (globe + `METHOD /path` monospace) — always blue: the
  // color encodes TYPE (HTTP endpoint), not severity. Cron uses the amber
  // cronBadge below. Pure repo-intel read; no findings involved.
  httpBadge: (): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "var(--font-mono, monospace)",
    padding: "2px 7px",
    borderRadius: 4,
    border: "1px solid rgba(59,130,246,0.35)",
    background: "rgba(59,130,246,0.12)",
    color: "#60a5fa",
  }),

  cronBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    fontWeight: 700,
    fontFamily: "var(--font-mono, monospace)",
    padding: "2px 7px",
    borderRadius: 4,
    border: "1px solid rgba(245,158,11,0.35)",
    background: "rgba(245,158,11,0.12)",
    color: "var(--warn)",
  } satisfies CSSProperties,

  endpointBadgeRow: {
    paddingLeft: 22,
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 5,
    marginBottom: 4,
  } satisfies CSSProperties,

  // Prior PRs section
  priorPrsToggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 0 4px",
    cursor: "pointer",
    fontSize: 12,
    color: "var(--text-muted)",
    fontWeight: 600,
    borderTop: "1px solid var(--border)",
    userSelect: "none" as const,
    background: "none",
    border: "none",
    width: "100%",
    textAlign: "left" as const,
  } satisfies CSSProperties,

  priorPrItem: {
    padding: "6px 0",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  } satisfies CSSProperties,

  priorPrTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,

  priorPrBullet: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--text-muted)",
    flexShrink: 0,
    opacity: 0.6,
  } satisfies CSSProperties,

  priorPrNumber: {
    fontSize: 12,
    fontWeight: 700,
    color: "#60a5fa",
    fontFamily: "var(--font-mono, monospace)",
    flexShrink: 0,
  } satisfies CSSProperties,

  priorPrTitle: {
    fontSize: 12,
    color: "var(--text-primary)",
    fontWeight: 600,
  } satisfies CSSProperties,

  priorPrMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "var(--text-muted)",
    paddingLeft: 12,
  } satisfies CSSProperties,

  priorPrAvatar: (color: string): CSSProperties => ({
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: color,
    color: "#fff",
    fontSize: 9,
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    textTransform: "lowercase" as const,
  }),

  priorPrNotes: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 2,
    paddingLeft: 12,
    lineHeight: 1.5,
  } satisfies CSSProperties,

  inlineCode: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 10,
    color: "#60a5fa",
    background: "rgba(59,130,246,0.1)",
    border: "1px solid rgba(59,130,246,0.25)",
    borderRadius: 4,
    padding: "0 4px",
  } satisfies CSSProperties,

  // Degraded badge in card header (subtle amber warning)
  degradedBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: 4,
    background: "rgba(245,158,11,0.12)",
    color: "var(--warn)",
    marginLeft: "auto",
    cursor: "default",
  } satisfies CSSProperties,

  // "+N more" muted row after callers list
  callerMore: {
    paddingLeft: 22,
    fontSize: 11,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
    marginBottom: 4,
  } satisfies CSSProperties,

  // --- ReviewFocusCard (bottom full-width "Review Focus — Read These First" card) ---
  reviewFocusCard: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,

  reviewFocusHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  reviewFocusCountBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 16,
    height: 16,
    padding: "0 5px",
    borderRadius: 8,
    fontSize: 10,
    fontWeight: 700,
    color: "var(--text-muted)",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
  } satisfies CSSProperties,

  reviewFocusBody: {
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  } satisfies CSSProperties,

  reviewFocusRow: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap" as const,
    gap: 8,
  } satisfies CSSProperties,

  reviewFocusPathLink: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    color: "#60a5fa",
    textDecoration: "none",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
  } satisfies CSSProperties,

  reviewFocusPathPlain: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  reviewFocusDash: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  reviewFocusReason: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  reviewFocusEmpty: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic" as const,
  } satisfies CSSProperties,

  // --- BriefEmptyState ("No brief yet" state of the PR BRIEF slot) ---
  briefEmptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    padding: "32px 24px",
    gap: 8,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,

  briefEmptyIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    display: "grid",
    placeItems: "center",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    marginBottom: 4,
  } satisfies CSSProperties,

  briefEmptyTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  briefEmptySubtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    maxWidth: 320,
    lineHeight: 1.5,
  } satisfies CSSProperties,

  briefEmptyError: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--crit)",
    marginTop: 4,
  } satisfies CSSProperties,
} as const;
