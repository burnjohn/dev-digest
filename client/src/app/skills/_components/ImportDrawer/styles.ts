import type { CSSProperties } from "react";

/** Co-located styles for ImportDrawer + its panels. */
export const s = {
  tabBody: { marginTop: 18 } satisfies CSSProperties,
  result: (ok: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    fontSize: 13,
    fontWeight: 600,
    color: ok ? "var(--ok)" : "var(--crit)",
  }),
  langChips: { display: "flex", gap: 8, margin: "14px 0 18px", flexWrap: "wrap" } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  cardList: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    padding: 16,
  } satisfies CSSProperties,
  cardHeader: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  cardName: { fontSize: 14, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  stars: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "var(--warn)",
  } satisfies CSSProperties,
  cardDesc: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: "8px 0 12px",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  cardFooter: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  repo: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  cardAction: { marginLeft: "auto" } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
