import type { CSSProperties } from "react";

/** Co-located styles for MountPoint. */
export const s = {
  wrap: {
    border: "1px dashed var(--border-strong)",
    borderRadius: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
} as const;
