import type { CSSProperties } from "react";

export const s = {
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    // No pre-wrap: the body is rendered as markdown now, so blank lines are
    // paragraph breaks. Keeping it would double every gap and preserve the
    // source's hard wraps mid-sentence.
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
