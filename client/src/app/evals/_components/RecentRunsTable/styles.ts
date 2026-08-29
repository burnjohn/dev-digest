import type { CSSProperties } from "react";

export const s = {
  /* Same shape as AgentDrillIn's runs table: a `minWidth` floor so the seven
     columns scroll rather than compress once the pane narrows. */
  scroll: { overflowX: "auto" } satisfies CSSProperties,
  table: {
    width: "100%",
    minWidth: 760,
    borderCollapse: "collapse",
    fontSize: 13,
  } satisfies CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    padding: "0 10px 8px",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  td: {
    padding: "10px",
    borderTop: "1px solid var(--border)",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  agentLink: {
    color: "var(--text-primary)",
    fontWeight: 600,
    textDecoration: "none",
  } satisfies CSSProperties,
  dateCell: { color: "var(--text-secondary)", whiteSpace: "nowrap" } satisfies CSSProperties,
  versionCell: { color: "var(--accent)", whiteSpace: "nowrap" } satisfies CSSProperties,
  /* Bar + percentage. The bar is `flex: 1` so a wide viewport spends its extra
     pixels on the three metric columns rather than on trailing whitespace. */
  metricCell: { padding: "10px", borderTop: "1px solid var(--border)", minWidth: 120 } satisfies CSSProperties,
  metricInner: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  barTrack: {
    flex: 1,
    minWidth: 40,
    height: 6,
    borderRadius: 3,
    background: "var(--border)",
    overflow: "hidden",
  } satisfies CSSProperties,
  barFill: { height: "100%", borderRadius: 3 } satisfies CSSProperties,
  barValue: {
    flexShrink: 0,
    width: 38,
    textAlign: "right",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  passCell: {
    padding: "10px",
    borderTop: "1px solid var(--border)",
    fontWeight: 700,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
