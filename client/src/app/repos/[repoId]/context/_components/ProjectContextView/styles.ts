import type { CSSProperties } from "react";

/** Co-located styles for ProjectContextView.

    This page is deliberately **full-bleed** rather than the centred
    `padding: "24px 32px 44px", maxWidth: 1100` container every other list page
    uses (`client/INSIGHTS.md` 2026-08-17). That insight exists because
    `AppFrame`'s `<main>` supplies no padding of its own — it does not require a
    centred box, and a centred box cannot produce `docs/mockups/Context Folder 1.png`'s
    edge-to-edge split. Each pane supplies its own padding instead, so `<main>`'s
    bare edge is still never exposed.

    The height chain that lets the list scroll under a pinned footer:
    `styles.css` sets `html, body { height: 100% }`, `AppFrame`'s `<main>` is
    `flex:1; minHeight:0; overflow:auto` inside a `100vh` column — so `page`'s
    `height: "100%"` resolves to a definite height and `minHeight: 0` on the
    panes lets their children shrink below content size and scroll. */
export const s = {
  page: {
    height: "100%",
    display: "flex",
    alignItems: "stretch",
    minHeight: 0,
  } satisfies CSSProperties,

  // ---- left pane: the file list ----
  listPane: {
    flex: "0 0 300px",
    minWidth: 240,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderRight: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  listHeader: {
    padding: "16px 14px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
  } satisfies CSSProperties,
  /** Matches `vendor/ui/shell/Sidebar`'s group labels (WORKSPACE / SKILLS LAB),
      which is the treatment mockup 1 gives this heading. */
  eyebrow: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  toolbar: { display: "flex", gap: 2, marginLeft: -6 } satisfies CSSProperties,
  list: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    listStyle: "none",
    margin: 0,
    padding: "2px 8px 10px",
  } satisfies CSSProperties,
  /** The row IS the preview control — there is no separate Preview button. The
      left border is always 2px so selecting a row never reflows the list. */
  rowBtn: (selected: boolean, hover: boolean): CSSProperties => ({
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
    padding: "6px 8px",
    borderRadius: 6,
    border: "none",
    borderLeft: "2px solid " + (selected ? "var(--accent)" : "transparent"),
    background: selected ? "var(--bg-hover)" : hover ? "var(--bg-elevated)" : "transparent",
    color: selected ? "var(--text-primary)" : "var(--text-secondary)",
    fontSize: 12.5,
    textAlign: "left",
    cursor: "pointer",
    transition: "background .12s, color .12s",
  }),
  rowIcon: { flexShrink: 0, color: "var(--text-muted)" } satisfies CSSProperties,
  rowPath: {
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  footer: {
    flexShrink: 0,
    borderTop: "1px solid var(--border)",
    padding: "10px 14px",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  bounded: {
    fontSize: 12,
    color: "var(--warn)",
    marginTop: 4,
  } satisfies CSSProperties,

  // ---- right pane: the selected document ----
  previewPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-primary)",
  } satisfies CSSProperties,
  previewHeader: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "13px 24px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  previewPath: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  /** The metadata AC-1 / AC-6 / AC-7 / AC-8 used to hang off every row: type
      badge, token estimate, `Used by N agents`, oversized marker. */
  previewMeta: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,
  previewBody: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "22px 28px 48px",
  } satisfies CSSProperties,
  previewPlaceholder: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  // ---- shared branch chrome ----
  loadingStack: { display: "grid", gap: 8, padding: "4px 2px" } satisfies CSSProperties,
  loadingLabel: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  centered: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    placeItems: "center",
    padding: "24px 32px",
    overflowY: "auto",
  } satisfies CSSProperties,
} as const;
