import type { CSSProperties } from "react";

/** Page-level styles for the Eval Case Editor route. */
export const s = {
  wrap: {
    margin: "24px 32px 44px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;
