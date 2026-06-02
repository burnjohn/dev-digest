import type { CSSProperties } from "react";

/** Co-located styles for SkillDetailView (extracted from inline styles). */
export const s = {
  backBar: { padding: "16px 24px 0" } satisfies CSSProperties,
  layout: { display: "flex", height: "calc(100vh - 92px)" } satisfies CSSProperties,
  loading: { flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  emptyPane: { flex: 1, display: "grid", placeItems: "center" } satisfies CSSProperties,
} as const;
