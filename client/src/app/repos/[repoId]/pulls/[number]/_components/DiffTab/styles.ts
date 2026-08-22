import type { CSSProperties } from "react";

export const s = {
  /** Right side of the section header: the Smart/Original toggle plus the
   *  existing show/hide-comments button, right-aligned on one row. */
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  } satisfies CSSProperties,
  toggleRow: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
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
