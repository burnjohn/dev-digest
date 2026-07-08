import type { CSSProperties } from "react";

/** Co-located styles for EvalDetailView. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1200, margin: "0 auto" } satisfies CSSProperties,
  backLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 13,
    color: "var(--text-muted)",
    textDecoration: "none",
    marginBottom: 12,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 22,
  } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  modelBadge: {
    fontSize: 12,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "2px 8px",
  } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  headerActions: { display: "flex", alignItems: "center", gap: 10, flexShrink: 0 } satisfies CSSProperties,
  kpiRow: { display: "flex", gap: 12, marginBottom: 6 } satisfies CSSProperties,
  sectionLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 10,
    marginTop: 28,
  } satisfies CSSProperties,
  // Metric-trend contained in a bordered card (matches the mockup) so the plot
  // is inset with padding rather than spanning the full content width.
  trendCard: {
    marginTop: 22,
    padding: "16px 20px 20px",
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  trendHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 14,
  } satisfies CSSProperties,
  historySection: { marginTop: 28 } satisfies CSSProperties,
} as const;
