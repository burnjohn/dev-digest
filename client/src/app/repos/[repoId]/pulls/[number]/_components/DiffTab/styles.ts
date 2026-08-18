import type { CSSProperties } from "react";

export const s = {
  /** Warning strip above the diff when `files` did not come live from GitHub. */
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "8px 12px",
    borderRadius: 6,
    marginBottom: 10,
  } satisfies CSSProperties,
  noticeIcon: { flexShrink: 0 } satisfies CSSProperties,
  noticeText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
};
