import type { CSSProperties } from "react";

/** Co-located styles for PageShell (extracted from inline styles). */
export const s = {
  container: { padding: "24px 32px 44px", maxWidth: 1200, margin: "0 auto" } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "flex-end", gap: 16, marginBottom: 20 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  actions: { marginLeft: "auto", display: "flex", gap: 10 } satisfies CSSProperties,
} as const;
