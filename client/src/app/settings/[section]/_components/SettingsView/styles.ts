import type { CSSProperties } from "react";

/** Co-located styles for the SettingsView shell (left sub-nav + section pane). */
export const s = {
  layout: { display: "flex", minHeight: "calc(100vh - 52px)" } satisfies CSSProperties,
  nav: {
    width: 210,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    padding: 16,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  navTitle: { fontSize: 16, fontWeight: 700, padding: "2px 10px 14px" } satisfies CSSProperties,
  navItem: (on: boolean): CSSProperties => ({
    padding: "8px 12px",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: on ? 600 : 500,
    cursor: "pointer",
    color: on ? "var(--text-primary)" : "var(--text-secondary)",
    background: on ? "var(--bg-hover)" : "transparent",
    marginBottom: 2,
  }),
  pane: { flex: 1, overflow: "auto", padding: "28px 32px" } satisfies CSSProperties,
} as const;
