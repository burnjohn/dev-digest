import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: "24px 28px 44px", maxWidth: 860 } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  search: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
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
  hint: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    marginBottom: 16,
  } satisfies CSSProperties,
  noMatch: { fontSize: 13, color: "var(--text-muted)", padding: "12px 0" } satisfies CSSProperties,
  list: {
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginBottom: 20,
  } satisfies CSSProperties,
  /** `dragging` = the row under the cursor's grip; `over` = the drop target. */
  row: (linked: boolean, dragging: boolean, over: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "9px 12px",
    borderRadius: 7,
    border: "1px solid " + (over
      ? "var(--accent)"
      : linked
        ? "var(--border-strong)"
        : "var(--border)"),
    background: linked ? "var(--bg-hover)" : "var(--bg-surface)",
    opacity: dragging ? 0.45 : 1,
    transition: "border-color .12s, opacity .12s",
  }),
  handle: (linked: boolean): CSSProperties => ({
    display: "inline-grid",
    placeItems: "center",
    width: 20,
    height: 22,
    padding: 0,
    border: "none",
    borderRadius: 5,
    background: "transparent",
    color: "var(--text-muted)",
    opacity: linked ? 1 : 0.35,
    cursor: linked ? "grab" : "default",
  }),
  name: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  disabled: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  status: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
