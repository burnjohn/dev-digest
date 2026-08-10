import type { CSSProperties } from "react";

/** Co-located styles for the FindingsIndicator strip + portalled popup panel. */
export const s = {
  strip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,
  iconButton: {
    display: "inline-flex",
    alignItems: "center",
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    cursor: "pointer",
    borderRadius: 5,
  } satisfies CSSProperties,
  muted: { color: "var(--text-muted)", fontSize: 13 } satisfies CSSProperties,
  // The panel is portalled to <body> with position:fixed (set inline from the
  // measured strip rect) so it is never clipped by the PR-list table card's
  // overflow:hidden. Only visual styling lives here.
  panel: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 9,
    boxShadow: "var(--shadow-modal)",
    zIndex: 60,
    animation: "ddpop .12s ease",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } satisfies CSSProperties,
  panelHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  headerCount: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  chips: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  chip: (active: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 9px",
    borderRadius: 999,
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "var(--accent-bg)" : "transparent",
    color: active ? "var(--accent-text)" : "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  }),
  // flex:1 + minHeight:0 lets the list scroll inside the height-capped panel.
  list: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: 6,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  rowTitle: {
    fontSize: 13,
    fontWeight: 550,
    color: "var(--text-primary)",
    minWidth: 0,
  } satisfies CSSProperties,
  rationale: {
    flexBasis: "100%",
    fontSize: 12,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  loadingRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "16px 12px",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  emptyRow: {
    padding: "16px 12px",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  // Visually hidden but kept for screen readers — icon-only chips still need a
  // text alternative naming the severity.
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: 0,
  } satisfies CSSProperties,
} as const;
