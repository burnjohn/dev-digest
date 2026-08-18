import type { CSSProperties } from "react";

/** Co-located styles for PreviewTab. */
export const s = {
  title: { fontSize: 16, fontWeight: 700, marginBottom: 4 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 } satisfies CSSProperties,
  body: {
    padding: 16,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-base)",
    fontSize: 13,
    color: "var(--text-primary)",
    overflowX: "auto",
  } satisfies CSSProperties,
} as const;
