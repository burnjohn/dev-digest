import type { CSSProperties } from "react";

export const s = {
  loading: { padding: 24, display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  body: { padding: 24, display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  /* `auto-fit`, not `repeat(4, 1fr)`: four fixed columns hold their share no
     matter how narrow the dialog gets, which is what pushed each tile's
     `old → new` row and its label onto extra lines. Below ~840px of body the
     tiles now wrap to a second row at a legible width instead of crushing. */
  deltaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(215px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  deltaCard: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  deltaLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  deltaValues: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    fontSize: 15,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  /* `flexShrink: 0` on all three children of `deltaValues`. `nowrap` alone
     stops the text breaking but lets flex squeeze a span narrower than its
     content, which clips instead of wrapping — the numbers have to keep their
     intrinsic width and let the CARD be the thing that grows. */
  deltaOld: { color: "var(--text-secondary)", flexShrink: 0 } satisfies CSSProperties,
  deltaArrow: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  deltaNew: {
    fontWeight: 700,
    fontSize: 18,
    color: "var(--text-primary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  deltaSep: { color: "var(--text-muted)", flexShrink: 0, opacity: 0.7 } satisfies CSSProperties,
  deltaSigned: { fontSize: 13, fontWeight: 600, flexShrink: 0 } satisfies CSSProperties,
  diffSection: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  diffHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  diffHeading: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  legend: { display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" } satisfies CSSProperties,
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  legendDot: { width: 7, height: 7, borderRadius: "50%", flexShrink: 0 } satisfies CSSProperties,
  sameVersion: {
    fontSize: 13,
    color: "var(--text-secondary)",
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  diffBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    maxHeight: 320,
    overflow: "auto",
    fontSize: 12.5,
    lineHeight: 1.6,
  } satisfies CSSProperties,
  hunkHeader: {
    display: "flex",
    padding: "2px 10px",
    background: "var(--accent-bg)",
    color: "var(--accent-text)",
    fontWeight: 600,
    position: "sticky",
    top: 0,
  } satisfies CSSProperties,
  diffLine: { display: "flex", padding: "0 10px", whiteSpace: "pre-wrap" } satisfies CSSProperties,
  diffLineSame: { color: "var(--text-secondary)" } satisfies CSSProperties,
  diffLineAdd: { background: "var(--code-add)", color: "var(--code-add-text)" } satisfies CSSProperties,
  diffLineDel: { background: "var(--code-del)", color: "var(--code-del-text)" } satisfies CSSProperties,
  /* `textAlign: right` + `tabular-nums` so a 3-digit prompt's gutter stays
     flush with a 2-digit one instead of shifting every line's text left. */
  diffGutter: {
    width: 30,
    flexShrink: 0,
    marginRight: 8,
    textAlign: "right",
    opacity: 0.55,
    userSelect: "none",
  } satisfies CSSProperties,
  diffMarker: { width: 16, flexShrink: 0, opacity: 0.8 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "space-between", gap: 8 } satisfies CSSProperties,
  /* The promote confirmation lives IN the footer rather than in a second
     `Modal`. Two dialogs would both attach `keydown` to `document` (see
     `vendor/ui/kit/Modal.tsx`), so one Escape would dismiss the confirm AND the
     comparison behind it, and the two focus traps would fight over Tab. */
  confirmRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  confirmText: {
    fontSize: 13,
    color: "var(--text-secondary)",
    flex: 1,
    minWidth: 220,
  } satisfies CSSProperties,
} as const;
