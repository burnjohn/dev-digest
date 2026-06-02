import type { CSSProperties } from "react";

/** Co-located styles for SkillListItem (extracted from inline styles). */
export const s = {
  item: (active: boolean, enabled: boolean): CSSProperties => ({
    padding: "12px 14px",
    borderRadius: 7,
    cursor: "pointer",
    border: "1px solid " + (active ? "var(--border-strong)" : "transparent"),
    background: active ? "var(--bg-hover)" : "transparent",
    opacity: enabled ? 1 : 0.55,
    marginBottom: 2,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  name: {
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  description: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 5,
    lineHeight: 1.4,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  metaRow: { display: "flex", gap: 8, marginTop: 8, alignItems: "center" } satisfies CSSProperties,
  typeChip: (color: string): CSSProperties => ({
    fontSize: 12,
    fontWeight: 600,
    color,
    background: color + "1a",
    padding: "1px 8px",
    borderRadius: 4,
  }),
  source: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  vetting: {
    marginLeft: "auto",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--warn)",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,
} as const;
