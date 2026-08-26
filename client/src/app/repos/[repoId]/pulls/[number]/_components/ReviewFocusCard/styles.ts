import type { CSSProperties } from "react";

/* Co-located styles for ReviewFocusCard — a full-width BAND rendered below
   the two-column card grid (OverviewTab's `cardGrid`), never a grid cell
   itself; placement is T9's. Mirrors BlastCard/IntentCard/ConventionCard: a
   bordered `bg-elevated` box under a SectionLabel header, with the same
   hand-rolled hover-tracked `<a>` shape ConventionCard uses for a truncating
   file link (client/INSIGHTS.md 2026-08-17 — `MonoLink` cannot truncate and
   its no-href branch is a dead `<button>`). */

export const s = {
  section: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  errorCard: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  retryButton: {
    background: "none",
    border: "none",
    padding: 0,
    color: "var(--accent)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
  // Loading skeleton — the accompanying text reuses `riskBrief.loading`
  // ("Generating risk brief…"), which already ends in "…".
  loadingText: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
  } satisfies CSSProperties,
  // Left-truncate with the full path in `title` (REQ-35). `direction: rtl` +
  // `textAlign: left` moves the browser's ellipsis to the START of the text
  // while the glyphs themselves stay left-to-right (Latin text has no bidi
  // direction of its own) — so the filename (the end of the path) stays
  // visible instead of the repo-root prefix. `minWidth: 0` is what lets this
  // flex child shrink below its content size at all inside the row's flex
  // row. Accent-coloured, hover-underlined — inline styles can't express
  // `:hover`, so the row tracks it in local state (as `ConventionCard` does).
  fileLink: (hovered: boolean): CSSProperties => ({
    flex: "0 1 340px",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl",
    textAlign: "left",
    fontSize: 13,
    color: "var(--accent-text)",
    textDecoration: hovered ? "underline" : "none",
    textUnderlineOffset: 2,
  }),
  // Same left-truncation as `fileLink`. The no-href degradation: plain,
  // non-interactive text — never `MonoLink`'s dead `<button>`
  // (client/INSIGHTS.md 2026-08-17).
  filePlain: {
    flex: "0 1 340px",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl",
    textAlign: "left",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  dash: {
    flexShrink: 0,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  reason: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
