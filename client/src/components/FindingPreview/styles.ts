import type { CSSProperties } from "react";

/** Co-located styles for FindingPreview (compact, read-only finding card). */
export const s = {
  card: (sevColor: string): CSSProperties => ({
    borderRadius: 8,
    borderStyle: "solid",
    borderColor: "var(--border)",
    borderWidth: 1,
    borderLeftWidth: 3,
    borderLeftColor: sevColor,
    background: "var(--bg-surface)",
    padding: "10px 12px",
    boxSizing: "border-box",
    minWidth: 0,
    // Long file paths / titles break instead of forcing horizontal scroll.
    overflowWrap: "anywhere",
  }),
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  // Wraps (the file path can be long) so the confidence never gets clipped or
  // pushed out of the panel.
  metaRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 4,
    marginTop: 5,
    minWidth: 0,
  } satisfies CSSProperties,
  // Rationale clamped to 2 lines — the popover is a teaser; the full text lives
  // on the detail Findings panel.
  rationale: {
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    marginTop: 6,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
} as const;
