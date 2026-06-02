import type { CSSProperties } from "react";

/** Co-located styles for the Onboarding Tour view (extracted from inline styles). */
export const s = {
  page: { padding: "28px 32px", maxWidth: 1080, margin: "0 auto" } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  layout: { display: "grid", gridTemplateColumns: "180px 1fr", gap: 32 } satisfies CSSProperties,
  tocSticky: { position: "sticky", top: 16 } satisfies CSSProperties,
  tocLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
  } satisfies CSSProperties,
  tocLink: (active: boolean): CSSProperties => ({
    display: "block",
    fontSize: 13,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: active ? 600 : 500,
    padding: "6px 0 6px 12px",
    borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
    marginLeft: -2,
    textDecoration: "none",
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, flex: 1 } satisfies CSSProperties,
} as const;
