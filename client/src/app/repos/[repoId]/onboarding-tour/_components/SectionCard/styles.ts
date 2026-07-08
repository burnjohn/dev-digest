import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    overflow: "hidden",
    scrollMarginTop: 16,
  } satisfies CSSProperties,

  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "12px 16px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
    fontWeight: 700,
    color: "var(--text-primary)",
    background: "transparent",
    border: "none",
    borderBottomWidth: 1,
    cursor: "pointer",
    textAlign: "left" as const,
  } satisfies CSSProperties,

  title: {
    letterSpacing: "0.01em",
  } satisfies CSSProperties,

  cardBody: {
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  } satisfies CSSProperties,

  degradedBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 7px",
    borderRadius: 4,
    background: "rgba(245,158,11,0.12)",
    color: "var(--warn)",
    marginLeft: 8,
    cursor: "default",
  } satisfies CSSProperties,
} as const;
