import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: "24px 28px 44px", maxWidth: 860 } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 4,
    marginBottom: 18,
  } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    padding: "20px 24px",
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
