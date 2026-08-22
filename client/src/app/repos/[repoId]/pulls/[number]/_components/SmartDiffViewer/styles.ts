import type { CSSProperties } from "react";

export const s = {
  root: { display: "flex", flexDirection: "column", gap: 0 } satisfies CSSProperties,
  groupSection: { marginBottom: 22 } satisfies CSSProperties,
  groupHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 10,
  } satisfies CSSProperties,
  groupTitle: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  groupSubtitle: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  groupCount: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  fileList: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  /** `position: relative` anchor for the REQ-5 large-file badge overlay — kept
   *  a plain sibling of `FileCard` rather than a prop on it, since FileCard
   *  is T3's owned file and this component composes it, never edits it. */
  fileWrap: { position: "relative" } satisfies CSSProperties,
  largeBadge: {
    position: "absolute",
    top: 9,
    right: 76,
    zIndex: 1,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    fontWeight: 600,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "1px 6px",
    borderRadius: 5,
    pointerEvents: "none",
  } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  toggleRow: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
} as const;

/** Small coloured square bullet in front of a group title (mockup §5.8). */
export function groupBulletStyle(color: string): CSSProperties {
  return { width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 };
}
