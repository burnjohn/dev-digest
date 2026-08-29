import type { CSSProperties } from "react";

/* SKILL-ARM ONLY. Nothing here is read by the agent arm — its own
   `tabList`/`tabButton` live in `../../styles.ts` and are deliberately NOT
   shared with these, so a skill-side tweak can never leak across. */
export const s = {
  tabList: { display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 10 } satisfies CSSProperties,
  tabButton: (active: boolean, disabled: boolean): CSSProperties => ({
    padding: "8px 12px",
    border: "none",
    background: "transparent",
    borderBottom: "2px solid " + (active ? "var(--accent)" : "transparent"),
    marginBottom: -1,
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: disabled ? "var(--text-muted)" : active ? "var(--text-primary)" : "var(--text-secondary)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  }),

  // Sits in the Filename `FormField`'s label row, so it carries no margin of
  // its own — the row already supplies the spacing.
  subTabList: { display: "flex", gap: 4 } satisfies CSSProperties,
  subTabButton: (active: boolean): CSSProperties => ({
    padding: "4px 10px",
    border: "1px solid " + (active ? "var(--accent)" : "var(--border)"),
    borderRadius: 6,
    background: active ? "var(--bg-hover)" : "transparent",
    fontSize: 12.5,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    cursor: "pointer",
  }),

  // `-8px` claws back the `FormField` above's fixed `marginBottom: 20` so the
  // warning reads as attached to the After editor rather than floating.
  warning: {
    fontSize: 12,
    color: "var(--warn)",
    margin: "-8px 0 12px",
  } satisfies CSSProperties,
} as const;
