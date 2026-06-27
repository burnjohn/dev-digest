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
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    alignItems: "start",
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
    borderLeft: "3px solid var(--accent-text)",
    paddingLeft: 12,
    margin: 0,
  } satisfies CSSProperties,

  scopeSection: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  scopeHeader: (color: string): CSSProperties => ({
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color,
    marginBottom: 2,
  }),

  scopeItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  } satisfies CSSProperties,

  riskChip: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-secondary)",
    background: "var(--bg-surface)",
    border: `1px solid var(--border)`,
    borderRadius: 6,
    padding: "4px 10px",
  }),

  riskDot: (color: string): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),

  riskGrid: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
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

  httpBadge: (method: string): CSSProperties => ({
    display: "inline-block",
    fontSize: 10,
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: 4,
    background:
      method === "GET"
        ? "rgba(34,197,94,0.15)"
        : method === "POST"
          ? "rgba(59,130,246,0.15)"
          : method === "DELETE"
            ? "rgba(239,68,68,0.15)"
            : "rgba(147,51,234,0.15)",
    color:
      method === "GET"
        ? "var(--ok)"
        : method === "POST"
          ? "#60a5fa"
          : method === "DELETE"
            ? "var(--crit)"
            : "#c084fc",
  }),

  cronBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: 4,
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
  } satisfies CSSProperties,

  priorPrItem: {
    padding: "6px 0",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  } satisfies CSSProperties,

  priorPrTitle: {
    fontSize: 12,
    color: "var(--text-secondary)",
    fontWeight: 500,
  } satisfies CSSProperties,

  priorPrMeta: {
    display: "flex",
    gap: 8,
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
