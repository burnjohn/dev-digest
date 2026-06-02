import type { CSSProperties } from "react";

/** Co-located styles for SectionTitle. */
export const s = {
  h2: { fontSize: 20, fontWeight: 700, marginBottom: 5 } satisfies CSSProperties,
  body: { fontSize: 14, color: "var(--text-secondary)", marginBottom: 24 } satisfies CSSProperties,
} as const;
