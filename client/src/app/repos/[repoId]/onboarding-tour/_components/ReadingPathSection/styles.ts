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
    gap: 14,
  } satisfies CSSProperties,

  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
  } satisfies CSSProperties,

  index: {
    display: "inline-grid",
    placeItems: "center",
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: "var(--sugg-bg)",
    color: "var(--sugg)",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  } satisfies CSSProperties,

  rowMain: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
  } satisfies CSSProperties,

  path: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  rationale: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,
} as const;
