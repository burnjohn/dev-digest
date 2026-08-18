import type { CSSProperties } from "react";

/** Co-located styles for the SkillDetail shell (header + tabs + body). */
export const s = {
  wrap: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "16px 20px 0",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  tabsBar: { marginTop: 12 } satisfies CSSProperties,
  body: { flex: 1, minHeight: 0, overflow: "auto", padding: 20 } satisfies CSSProperties,
} as const;
