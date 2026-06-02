import type { CSSProperties } from "react";

/** Co-located styles for SkillsView (extracted from inline styles). */
export const s = {
  layout: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  sidebar: {
    width: 290,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  sidebarHeader: { padding: "16px 16px 12px" } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: "var(--text-primary)",
    background: "transparent",
    border: "none",
    outline: "none",
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  list: { flex: 1, overflow: "auto", padding: "0 10px 10px" } satisfies CSSProperties,
  loadingStack: { padding: 10, display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  emptyPane: { flex: 1, display: "grid", placeItems: "center", background: "var(--bg-surface)" } satisfies CSSProperties,
} as const;
