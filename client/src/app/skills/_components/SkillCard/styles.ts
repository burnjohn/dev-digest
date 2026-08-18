import type { CSSProperties } from "react";

/** Co-located styles for SkillCard — a row in the narrow skills list column. */
export const s = {
  card: (active: boolean, enabled: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 6,
    width: "100%",
    padding: "12px 14px",
    borderRadius: 9,
    border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
    background: active ? "var(--bg-hover)" : "transparent",
    cursor: "pointer",
    textAlign: "left",
    // A disabled skill is in no prompt; dim it so the list reads at a glance.
    opacity: enabled ? 1 : 0.55,
    transition: "border-color .12s ease, background .12s ease, opacity .12s ease",
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  iconBox: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    borderRadius: 6,
    background: "var(--bg-hover)",
    color,
    flexShrink: 0,
  }),
  name: {
    flex: 1,
    fontSize: 13,
    fontWeight: 650,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  description: {
    fontSize: 12,
    lineHeight: 1.4,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } satisfies CSSProperties,
  statsRow: {
    fontSize: 11,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
} as const;
