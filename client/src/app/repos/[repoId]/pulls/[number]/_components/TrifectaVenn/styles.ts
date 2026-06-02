import type { CSSProperties } from "react";

/** Co-located styles for TrifectaVenn (extracted from inline styles). */
export const s = {
  wrap: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    padding: "12px 14px",
    background: "var(--crit-bg)",
    borderRadius: 7,
    border: "1px solid rgba(239,68,68,0.25)",
  } satisfies CSSProperties,
  svg: { flexShrink: 0 } satisfies CSSProperties,
  legend: { display: "flex", flexDirection: "column", gap: 5 } satisfies CSSProperties,
  heading: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--crit)",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  legendRow: (present: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: present ? "var(--text-secondary)" : "var(--text-muted)",
  }),
  checkIcon: { color: "var(--crit)" } satisfies CSSProperties,
  dotIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
