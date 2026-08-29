import type { CSSProperties } from "react";

export const s = {
  inner: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  /* `flex: 1` so a wide viewport spends its extra pixels lengthening the bars
     rather than on trailing whitespace. */
  track: {
    flex: 1,
    minWidth: 40,
    height: 6,
    borderRadius: 3,
    background: "var(--border)",
    overflow: "hidden",
  } satisfies CSSProperties,
  fill: { display: "block", height: "100%", borderRadius: 3 } satisfies CSSProperties,
  value: {
    flexShrink: 0,
    width: 38,
    textAlign: "right",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
