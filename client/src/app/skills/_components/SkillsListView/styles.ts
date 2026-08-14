import type { CSSProperties } from "react";
import { LIST_WIDTH } from "./constants";

/** Co-located styles for SkillsListView. */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1400, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 14, marginBottom: 20 } satisfies CSSProperties,
  headerText: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 4,
    maxWidth: 620,
  } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 200,
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  split: { display: "flex", gap: 20, alignItems: "flex-start" } satisfies CSSProperties,
  listCol: {
    width: LIST_WIDTH,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxHeight: "calc(100vh - 200px)",
    overflow: "auto",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    padding: 8,
  } satisfies CSSProperties,
  loadingList: { display: "flex", flexDirection: "column", gap: 8, padding: 8 } satisfies CSSProperties,
  detailCol: {
    flex: 1,
    minWidth: 0,
    position: "sticky",
    top: 24,
  } satisfies CSSProperties,
  selectPlaceholder: {
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    padding: "48px 24px",
  } satisfies CSSProperties,
} as const;
