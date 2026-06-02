import type { CSSProperties } from "react";

/** Co-located styles for ConfCard. */
export const s = {
  card: (color: string): CSSProperties => ({
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${color}`,
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 14,
    marginBottom: 12,
  }),
  title: { fontSize: 14, fontWeight: 600, lineHeight: 1.4 } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.45 } satisfies CSSProperties,
  evidence: { marginTop: 10 } satisfies CSSProperties,
} as const;
