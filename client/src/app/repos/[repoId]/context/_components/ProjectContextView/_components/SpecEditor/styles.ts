import type { CSSProperties } from "react";

/** Co-located styles for the spec preview/edit panel. */
export const s = {
  header: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  icon: { color: "var(--accent)" } satisfies CSSProperties,
  path: { fontSize: 14, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  modeToggle: { display: "flex", gap: 5, background: "var(--bg-hover)", borderRadius: 6, padding: 2 } satisfies CSSProperties,
  modeBtn: (active: boolean): CSSProperties => ({
    border: "none",
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 12px",
    borderRadius: 5,
    cursor: "pointer",
    textTransform: "capitalize",
  }),
  markdown: { fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
