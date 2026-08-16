import type { CSSProperties } from "react";

/** 52px is the AppShell topbar height — the split fills the rest of the viewport. */
export const s = {
  split: { display: "flex", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  rail: {
    width: 300,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  railHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 16px 12px",
  } satisfies CSSProperties,
  railTitle: { fontSize: 18, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  railList: { flex: 1, overflow: "auto", padding: "0 12px 12px" } satisfies CSSProperties,
  loading: {
    flex: 1,
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 28px 14px",
    flexShrink: 0,
  } satisfies CSSProperties,
  headerIcon: { color: "var(--accent)" } satisfies CSSProperties,
  headerName: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  editor: { flex: 1, minHeight: 0 } satisfies CSSProperties,
} as const;
