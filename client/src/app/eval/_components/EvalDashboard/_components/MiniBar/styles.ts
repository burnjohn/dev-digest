import type { CSSProperties } from "react";

/** Co-located styles for MiniBar. */
export const s = {
  wrap: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  track: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    background: "var(--bg-hover)",
    overflow: "hidden",
  } satisfies CSSProperties,
  fill: (pct: number, color: string): CSSProperties => ({
    width: `${pct}%`,
    height: "100%",
    background: color,
    borderRadius: 3,
  }),
  value: { fontSize: 12, width: 30, textAlign: "right" } satisfies CSSProperties,
} as const;
