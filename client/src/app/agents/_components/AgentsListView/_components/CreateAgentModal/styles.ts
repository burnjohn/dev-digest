import type { CSSProperties } from "react";

/** Co-located styles for CreateAgentModal. */
export const s = {
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  body: { padding: 24 } satisfies CSSProperties,
} as const;
