import type { CSSProperties } from "react";

export const s = {
  legend: { display: "flex", alignItems: "center", gap: 18, marginBottom: 10 } satisfies CSSProperties,
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  legendSwatch: { width: 14, height: 2, borderRadius: 1 } satisfies CSSProperties,
  empty: {
    padding: "36px 16px",
    textAlign: "center",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
