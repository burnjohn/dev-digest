import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillFromConventionsModal. */
export const s = {
  body: { display: "grid", gap: 14 } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--accent-border, var(--border))",
    background: "var(--accent-bg)",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  row: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
    alignItems: "start",
  } satisfies CSSProperties,
  enabledBox: { display: "grid", gap: 6 } satisfies CSSProperties,
  enabledHint: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
  } satisfies CSSProperties,
  footerNote: {
    marginRight: "auto",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
