import type { CSSProperties } from "react";

/** Co-located styles for AgentStatsTab (extracted from inline styles). */
export const s = {
  loadingStack: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  emptyWrap: {
    border: "1px dashed var(--border-strong)",
    borderRadius: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  root: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  metricsRow: { display: "flex", gap: 14 } satisfies CSSProperties,
  outcomesRow: { display: "flex", gap: 20, alignItems: "center", padding: "12px 2px" } satisfies CSSProperties,
  severityWrap: { padding: "5px 2px" } satisfies CSSProperties,
  costRow: { display: "flex", gap: 14 } satisfies CSSProperties,
  trendCard: {
    flex: 1,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: 18,
  } satisfies CSSProperties,
  trendLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.03em",
    marginBottom: 10,
  } satisfies CSSProperties,
  trendEmpty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,

  // ---- Outcome ----
  outcome: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  outcomeDot: (color: string): CSSProperties => ({ width: 10, height: 10, borderRadius: 3, background: color }),
  outcomeLabel: { fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
  outcomeValue: { fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  outcomeShare: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
