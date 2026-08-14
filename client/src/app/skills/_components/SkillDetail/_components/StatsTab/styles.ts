import type { CSSProperties } from "react";

/** Co-located styles for StatsTab. */
export const s = {
  tiles: { display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" } satisfies CSSProperties,
  // Mirrors MetricCard's own frame so the one custom tile (Accept Rate, which
  // needs a CircularScore MetricCard cannot render) sits flush with the rest.
  tile: {
    flex: 1,
    minWidth: 160,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  tileLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
  tileRingRow: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  tileEmpty: {
    fontSize: 32,
    fontWeight: 700,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  sections: { display: "flex", gap: 16, flexWrap: "wrap" } satisfies CSSProperties,
  section: {
    flex: 1,
    minWidth: 260,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 18,
  } satisfies CSSProperties,
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    marginBottom: 14,
  } satisfies CSSProperties,
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 0",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  agentName: { flex: 1, fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
} as const;
