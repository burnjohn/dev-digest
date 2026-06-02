import type { CSSProperties } from "react";

/** Co-located styles for a conformance Column. */
export const s = {
  col: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  head: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    background: `${color}1a`,
    marginBottom: 14,
  }),
  headIcon: (color: string): CSSProperties => ({ color }),
  headLabel: (color: string): CSSProperties => ({ fontSize: 14, fontWeight: 600, color }),
  count: (color: string): CSSProperties => ({ marginLeft: "auto", fontSize: 13, fontWeight: 700, color }),
  none: { fontSize: 13, color: "var(--text-muted)", padding: "5px 2px" } satisfies CSSProperties,
} as const;
