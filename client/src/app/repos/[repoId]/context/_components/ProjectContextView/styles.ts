import type { CSSProperties } from "react";

/** Co-located styles for the Project Context view (extracted from inline styles). */
export const s = {
  page: { padding: "28px 32px", maxWidth: 1080, margin: "0 auto" } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  progressWrap: { marginBottom: 20 } satisfies CSSProperties,
  layout: (hasPath: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: hasPath ? "300px 1fr" : "1fr",
    gap: 28,
  }),
  specList: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  specCard: { padding: "12px 14px", cursor: "pointer" } satisfies CSSProperties,
  specCardSelected: { padding: "12px 14px", cursor: "pointer", outline: "1px solid var(--accent)" } satisfies CSSProperties,
  specRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  specIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  specPath: {
    fontSize: 13,
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  specSize: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
