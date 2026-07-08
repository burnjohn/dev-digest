import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  } satisfies CSSProperties,

  body: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
    margin: 0,
  } satisfies CSSProperties,

  cardsRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 10,
  } satisfies CSSProperties,

  card: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    minWidth: 200,
    flex: "1 1 220px",
  } satisfies CSSProperties,

  cardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  targetPath: {
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  complexityBadge: {
    display: "inline-flex",
    alignSelf: "flex-start",
    alignItems: "center",
    fontSize: 11,
    fontWeight: 600,
    padding: "2px 9px",
    borderRadius: 5,
    border: "1px solid transparent",
    marginTop: 2,
  } satisfies CSSProperties,
} as const;
