import type { CSSProperties } from "react";

/** Co-located styles for IntentCard. Mirrors OverviewTab's descriptionBox card
    (border + bg-elevated + radius) so the two Overview-tab sections match. */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  errorCard: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  retryButton: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--accent)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
  summaryRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  // Italic quote with a left rule (mockup). Per-side longhands only — `borderColor`
  // is ITSELF a four-side shorthand, so pairing it with `borderLeftColor` still
  // trips React's shorthand/longhand rerender warning (see FindingCard/styles.ts).
  summary: {
    margin: 0,
    fontSize: 14,
    fontStyle: "italic",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    flex: 1,
    minWidth: 200,
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: "var(--border-strong)",
    paddingLeft: 12,
  } satisfies CSSProperties,
  // Intrinsic reflow, no media query: two children collapse to one full-width
  // column once the container drops below ~2x260px + gap (auto-fit, not
  // auto-fill — see plan 05 "The responsive answer, up front").
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: 18,
    marginTop: 16,
  } satisfies CSSProperties,
  scopeLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  scopeList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  scopeRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  scopeIcon: (color: string): CSSProperties => ({
    flexShrink: 0,
    marginTop: 2,
    color,
  }),
  scopeEmpty: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
