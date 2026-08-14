import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  title: { fontSize: 16, fontWeight: 700, marginBottom: 16 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  rowHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    cursor: "pointer",
    background: "none",
    border: "none",
    width: "100%",
    textAlign: "left",
  } satisfies CSSProperties,
  when: { fontSize: 12, color: "var(--text-secondary)", flex: 1 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  body: {
    padding: "0 14px 14px",
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  bodyBox: {
    padding: 12,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-base)",
    overflowX: "auto",
    marginBottom: 10,
  } satisfies CSSProperties,
} as const;
