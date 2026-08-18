import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView. Mirrors AgentsListView / SkillsListView. */
export const s = {
  // `AppFrame`'s <main> is `{ flex:1, minHeight:0, overflow:"auto" }` — no padding,
  // no max width. Every list page supplies its own container; this value is copied
  // verbatim from AgentsListView so the three pages share one gutter.
  page: {
    padding: "24px 32px 44px",
    maxWidth: 1100,
    margin: "0 auto",
  } satisfies CSSProperties,
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 18,
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: 0,
  } satisfies CSSProperties,
  repoName: { color: "var(--accent)" } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "6px 0 0",
  } satisfies CSSProperties,
  headerActions: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  } satisfies CSSProperties,
  triageCount: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  toolbarRight: { marginLeft: "auto" } satisfies CSSProperties,
  loadingStack: { display: "grid", gap: 12 } satisfies CSSProperties,
} as const;
