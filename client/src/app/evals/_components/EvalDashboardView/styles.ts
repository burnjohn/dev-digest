import type { CSSProperties } from "react";

/* AppFrame's <main> has no padding (client/INSIGHTS.md 2026-08-17) — every
   page supplies its own container. This page keeps that padding but drops the
   `maxWidth: 1100` half of the rule: at 1900px the cap left a ~500px dead
   gutter beside a runs table that wants every pixel it can get. The 2026-08-26
   entry already carves out that opt-out — the rule exists because `<main>` has
   no padding, and the padding below is what satisfies it. */
export const s = {
  page: { padding: "24px 32px 44px", width: "100%" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 20,
  } satisfies CSSProperties,
  headerMain: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 13.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  section: { marginBottom: 26 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "16px 18px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    textDecoration: "none",
    color: "inherit",
  } satisfies CSSProperties,
  rowMain: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 } satisfies CSSProperties,
  /* `minWidth: 0` + wrap so the `provider/model` mono text folds under the
     name as the row narrows. Without it the title is the only unbounded child
     of a row whose `metrics` block is `flexShrink: 0`, so it overflows. */
  rowTitle: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  agentName: { fontSize: 15, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  rowMeta: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  sparkCell: { flexShrink: 0, display: "flex", alignItems: "center" } satisfies CSSProperties,
  metrics: { display: "flex", alignItems: "center", gap: 22, flexShrink: 0 } satisfies CSSProperties,
  metric: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 } satisfies CSSProperties,
  metricLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metricValue: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
} as const;
