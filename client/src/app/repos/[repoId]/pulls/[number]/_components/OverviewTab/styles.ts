import type { CSSProperties } from "react";

// Shared sizing for the two Overview-tab cards (Intent + Blast Radius).
// `cardGrid`'s default `align-items: stretch` already matches the grid ITEM
// height (the cards' root `<section>`) to the taller row — the only real
// problem was BlastCard's symbol list growing unbounded and dragging that
// row with it. One rule generalises the owner's "min on Intent, max on
// Blast" in both directions: give both cards the SAME min/max via `cardSlot`
// below, so the shorter card stretches to meet the taller one (capped at
// MAX) and the taller one scrolls internally past MAX. Named constants so
// the sizing is a one-line tweak — never hardcode these pixel values again
// in BlastCard/styles.ts or IntentCard/styles.ts.
export const OVERVIEW_CARD_MIN_HEIGHT = 320;
export const OVERVIEW_CARD_MAX_HEIGHT = 560;

export const s = {
  // D1: IntentCard + BlastCard side by side (docs/mockups/blast-radius.png).
  // Intrinsic reflow, no media query — same auto-fit pattern as
  // IntentCard/styles.ts `scopeGrid`, collapsing to one column once the
  // container drops below ~2x420px + gap.
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
    gap: 20,
  } satisfies CSSProperties,
  // Grid-item slot wrapping each card. `minHeight: 0` is NOT set here on
  // purpose — this outer box carries the real min/max — but every
  // descendant between this slot and BlastCard's scrolling symbol list DOES
  // need `minHeight: 0` (BlastCard/styles.ts `section`/`card`), or the
  // classic flexbox gotcha applies: a flex item won't shrink below its
  // content size, `maxHeight` becomes a silent no-op, and the card just
  // grows past it with no scrollbar.
  cardSlot: {
    display: "flex",
    flexDirection: "column",
    minHeight: OVERVIEW_CARD_MIN_HEIGHT,
    maxHeight: OVERVIEW_CARD_MAX_HEIGHT,
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
