import type { CSSProperties } from "react";

/** Co-located styles for FindingsPanel (extracted from inline styles). */
export const s = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  divider: {
    width: 1,
    height: 18,
    background: "var(--border)",
    margin: "0 2px",
  } satisfies CSSProperties,
  toggleGroup: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  pillGroup: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  pill: (active: boolean, color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 10px",
    borderRadius: 20,
    border: `1px solid ${active ? color : "var(--border)"}`,
    background: active ? color : "transparent",
    color: active ? "#fff" : "var(--text-secondary)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.02em",
    transition: "background 0.1s, border-color 0.1s, color 0.1s",
  }),
  pillCount: (active: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 400,
    opacity: active ? 0.85 : 0.7,
  }),
} as const;
