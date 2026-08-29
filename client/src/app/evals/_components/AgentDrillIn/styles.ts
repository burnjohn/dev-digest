import type { CSSProperties } from "react";

export const s = {
  /* Padding but no `maxWidth` — see EvalDashboardView/styles.ts's header for
     why the 2026-08-17 container rule's cap is dropped on the eval pages. */
  page: { padding: "24px 32px 44px", width: "100%" } satisfies CSSProperties,
  header: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 } satisfies CSSProperties,
  headerTitle: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 13.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    color: "var(--text-primary)",
    fontSize: 13.5,
    marginBottom: 18,
  } satisfies CSSProperties,
  section: { marginBottom: 26 } satisfies CSSProperties,
  /* Intrinsic reflow, no media query — the house idiom (IntentCard/styles.ts
     `scopeGrid`, EvalsTab/styles.ts `metricGrid`). `auto-fit`, not
     `auto-fill`: the empty tracks collapse, so three cards still stretch to
     three full-width columns on a wide monitor and fold to 2/1 as the pane
     narrows, which `repeat(3, 1fr)` never did. */
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  metricCard: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 16,
  } satisfies CSSProperties,
  /* Label left, sparkline right — the spark sits in the card's own corner
     rather than under the number, so the value stays the card's focal point. */
  metricHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  } satisfies CSSProperties,
  metricSpark: { flexShrink: 0, display: "block", lineHeight: 0 } satisfies CSSProperties,
  metricLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metricRow: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 } satisfies CSSProperties,
  metricValue: { fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  metricDelta: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  tableToolbar: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 } satisfies CSSProperties,
  selectedCount: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  /* Seven columns need a floor: below it the table scrolls inside
     `tableScroll` instead of compressing every cell (precedent:
     ConventionCard/styles.ts's `overflowX`). */
  tableScroll: { overflowX: "auto" } satisfies CSSProperties,
  table: {
    width: "100%",
    minWidth: 820,
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
  checkboxCell: { width: 32, padding: "10px" } satisfies CSSProperties,
  dateCell: { color: "var(--text-secondary)", whiteSpace: "nowrap" } satisfies CSSProperties,
  versionCell: { color: "var(--accent)", whiteSpace: "nowrap" } satisfies CSSProperties,
  metricCell: {
    padding: "10px",
    borderTop: "1px solid var(--border)",
    minWidth: 130,
  } satisfies CSSProperties,
  passCell: {
    padding: "10px",
    borderTop: "1px solid var(--border)",
    fontWeight: 700,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
