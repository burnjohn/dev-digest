import type { CSSProperties } from "react";

/** Co-located styles for the Eval Dashboard's AgentCard (full-width row).
 *  Proportions mirror the mockup: a content-sized identity block on the left,
 *  the recall sparkline stretching across the flexible middle, and three
 *  fixed metric columns + chevron pinned right. */
export const s = {
  card: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    padding: "16px 20px",
    borderRadius: 12,
    cursor: "pointer",
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 9,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  leftText: {
    // Content-sized: the identity block is as wide as its content needs, and a
    // flexible spacer (below) claims the rest of the row. The agent NAME never
    // truncates; the (possibly long) model badge shrinks/ellipsizes instead.
    flex: "0 1 auto",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,
  nameRow: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } satisfies CSSProperties,
  name: {
    fontSize: 15,
    fontWeight: 700,
    whiteSpace: "nowrap",
    // Name has priority — it does not shrink/truncate; the model badge does.
    flexShrink: 0,
  } satisfies CSSProperties,
  modelBadge: {
    fontSize: 11,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderRadius: 5,
    padding: "1px 6px",
    maxWidth: 220,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flexShrink: 1,
  } satisfies CSSProperties,
  spacer: { flex: "1 1 16px", minWidth: 16 } satisfies CSSProperties,
  degradedChip: {
    fontSize: 10.5,
    fontWeight: 600,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    borderRadius: 5,
    padding: "1px 6px",
    flexShrink: 0,
  } satisfies CSSProperties,
  meta: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  sparklineBox: {
    // Compact fixed-width glyph pinned to the right, next to the metric
    // columns (matches the mockup — not a full-width stretch).
    flexShrink: 0,
    width: 96,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  } satisfies CSSProperties,
  sparklineEmpty: {
    fontSize: 16,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metricsGroup: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    flexShrink: 0,
  } satisfies CSSProperties,
  metricCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    minWidth: 52,
  } satisfies CSSProperties,
  metricLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metricValue: { fontSize: 20, fontWeight: 700, lineHeight: 1 } satisfies CSSProperties,
} as const;
