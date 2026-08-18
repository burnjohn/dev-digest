import type { CSSProperties } from "react";

export const s = {
  box: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  summary: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.55,
  } satisfies CSSProperties,
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  } satisfies CSSProperties,
  scopeCol: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  scopeLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  scopeList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  chipsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  } satisfies CSSProperties,
  staleNote: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "var(--warn)",
  } satisfies CSSProperties,
  signalsNote: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  emptyBody: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
