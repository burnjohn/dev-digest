import type { CSSProperties } from "react";

export const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  } satisfies CSSProperties,

  section: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,

  sectionHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    background: "var(--bg-elevated)",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    flex: 1,
  } satisfies CSSProperties,

  fileCount: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  fileList: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,

  // FileRow
  fileRow: {
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  fileRowLast: {
    borderBottom: "none",
  } satisfies CSSProperties,

  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 14px",
    cursor: "pointer",
    userSelect: "none",
  } satisfies CSSProperties,

  filePath: {
    flex: 1,
    fontSize: 13,
    fontFamily: "monospace",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  additions: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--ok)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  deletions: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--error)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  findingBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f59e0b",
    color: "#fff",
    borderRadius: "999px",
    fontSize: 11,
    fontWeight: 700,
    padding: "1px 7px",
    whiteSpace: "nowrap",
    cursor: "pointer",
  } satisfies CSSProperties,

  chevron: (expanded: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: expanded ? "rotate(90deg)" : "none",
    transition: "transform .15s",
    fontSize: 12,
    flexShrink: 0,
  }),

  emptyBody: {
    padding: "12px 14px",
    fontSize: 13,
    color: "var(--text-muted)",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  spinner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    color: "var(--text-muted)",
    fontSize: 14,
  } satisfies CSSProperties,
} as const;
