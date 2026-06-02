import type { CSSProperties } from "react";

/** Co-located styles for DiffView. */
export const s = {
  pre: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  line: (bg: string, isHunk: boolean): CSSProperties => ({
    background: bg,
    color: isHunk ? "var(--accent-text)" : "inherit",
  }),
} as const;
