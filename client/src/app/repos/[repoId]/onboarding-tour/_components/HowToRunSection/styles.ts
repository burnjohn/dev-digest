import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 10,
  } satisfies CSSProperties,

  body: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
    margin: 0,
  } satisfies CSSProperties,

  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  index: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    width: 16,
    flexShrink: 0,
  } satisfies CSSProperties,

  command: {
    flex: 1,
    fontSize: 12.5,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  copyBtn: {
    display: "inline-grid",
    placeItems: "center",
    width: 24,
    height: 24,
    borderRadius: 5,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-muted)",
    cursor: "pointer",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;
