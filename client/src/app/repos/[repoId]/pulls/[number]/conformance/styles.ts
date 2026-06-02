import type { CSSProperties } from "react";

/** Page-level styles for the standalone Conformance route. */
export const s = {
  wrap: { padding: "24px 32px 44px", maxWidth: 1040, margin: "0 auto" } satisfies CSSProperties,
  loading: { fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
