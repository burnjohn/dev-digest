import type { CSSProperties } from "react";

export const s = {
  card: {
    maxHeight: 360,
    overflowY: "auto",
    boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
    textAlign: "left",
    cursor: "default",
  } satisfies CSSProperties,
  title: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 10,
  } satisfies CSSProperties,
  empty: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  row: {
    padding: "8px 0",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  rowHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  rowTitle: { fontSize: 13, fontWeight: 600, color: "var(--text)" } satisfies CSSProperties,
  rowMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 3,
  } satisfies CSSProperties,
  rationale: {
    fontSize: 12,
    color: "var(--text-secondary)",
    marginTop: 4,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
} as const;
