import type { CSSProperties } from "react";

export const s = {
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
    padding: "8px 12px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  fileIcon: {
    color: "var(--text-muted)",
    flexShrink: 0,
    display: "inline-flex",
  } satisfies CSSProperties,

  rowMain: {
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  path: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    marginRight: 6,
  } satisfies CSSProperties,

  dash: {
    color: "var(--text-muted)",
    margin: "0 4px",
  } satisfies CSSProperties,

  rationale: {
    fontSize: 12,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,

  openAction: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    flexShrink: 0,
    whiteSpace: "nowrap" as const,
    padding: "4px 14px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--bg-elevated)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
