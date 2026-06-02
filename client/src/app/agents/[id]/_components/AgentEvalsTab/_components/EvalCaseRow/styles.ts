import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseRow. */
export const s = {
  row: (hover: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: hover ? "var(--bg-hover)" : "var(--bg-elevated)",
    marginBottom: 8,
  }),
  icon: (color: string): CSSProperties => ({ color, flexShrink: 0 }),
  body: { flex: 1, minWidth: 0, cursor: "pointer" } satisfies CSSProperties,
  name: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  actions: (hover: boolean): CSSProperties => ({ display: "flex", gap: 2, opacity: hover ? 1 : 0.4 }),
} as const;
