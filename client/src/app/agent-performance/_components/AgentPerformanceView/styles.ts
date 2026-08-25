import type { CSSProperties } from "react";

/** Co-located styles for AgentPerformanceView. Mirrors `CiRunsView/styles.ts`'s
 *  page/headerRow/h1/subtitle/panel/table shape (same "global workspace-wide
 *  page" family). */
export const s = {
  page: { padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  subtitle: { color: "var(--text-muted)", fontSize: 13, margin: "4px 0 0" } satisfies CSSProperties,

  periodRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  periodSelect: { minWidth: 140 } satisfies CSSProperties,
  dateInput: {
    padding: "8px 10px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 13,
  } satisfies CSSProperties,

  tiles: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 } satisfies CSSProperties,
  tileFootnote: { fontSize: 11, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,

  panels: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 } satisfies CSSProperties,
  panel: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    padding: 14,
  } satisfies CSSProperties,
  panelTitle: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, marginBottom: 10 } satisfies CSSProperties,

  tablePanel: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    color: "var(--text-muted)",
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    cursor: "pointer",
    userSelect: "none",
  } satisfies CSSProperties,
  td: { padding: "8px 12px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  viewLink: { color: "var(--accent)", fontSize: 12, textDecoration: "underline" } satisfies CSSProperties,

  estimatedBadge: { fontSize: 10, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
