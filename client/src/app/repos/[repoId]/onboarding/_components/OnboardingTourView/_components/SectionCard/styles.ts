import type { CSSProperties } from "react";

/** Co-located styles for an onboarding SectionCard (extracted from inline styles). */
export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elevated)",
    marginBottom: 16,
    overflow: "hidden",
    scrollMarginTop: 16,
  } satisfies CSSProperties,
  button: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "16px 18px",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
  } satisfies CSSProperties,
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 7,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
  } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 600, flex: 1 } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: open ? "rotate(180deg)" : "none",
    transition: "transform .15s",
  }),
  body: { padding: "0 18px 18px" } satisfies CSSProperties,
  markdown: { fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
  diagram: {
    marginTop: 14,
    padding: 14,
    borderRadius: 8,
    background: "var(--bg-hover)",
    fontSize: 12,
    overflow: "auto",
  } satisfies CSSProperties,
  links: { marginTop: 14, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  linkRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  linkIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  linkLabel: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
