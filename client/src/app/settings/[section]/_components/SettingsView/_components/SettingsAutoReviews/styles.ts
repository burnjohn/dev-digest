import type { CSSProperties } from "react";

/** Co-located styles for SettingsAutoReviews. */
export const s = {
  wrap: { maxWidth: 640 } satisfies CSSProperties,
  toggleCard: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "16px 18px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 20,
  } satisfies CSSProperties,
  toggleTitle: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  toggleSub: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  chips: { display: "flex", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  conditions: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  note: {
    display: "flex",
    gap: 10,
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  noteIcon: { flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  noteStrong: { color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
