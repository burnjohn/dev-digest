import type { CSSProperties } from "react";

// Sizing for the two GRID cards, Intent and Blast Radius. The PR Brief and
// Review Focus bands are not covered by these: both are full-width, content
// height, and outside the grid entirely (2026-08-26 layout rework). One cap
// applies to each grid card via its own `cardSlot`, so the two columns match
// height and neither can grow unboundedly. Named constants so the sizing is a
// one-line tweak — never hardcode these pixel values again in
// BlastCard/styles.ts or IntentCard/styles.ts.
export const OVERVIEW_CARD_MIN_HEIGHT = 320;
export const OVERVIEW_CARD_MAX_HEIGHT = 560;

export const s = {
  // Two-column grid: IntentCard (carrying the RISK AREAS section inside its
  // card) on the left, BlastCard on the right. Intrinsic reflow, no media
  // query — same auto-fit pattern as IntentCard/styles.ts `scopeGrid`,
  // collapsing to one column once the container drops below ~2x420px + gap.
  // The DOM order (brief band, Intent, Blast, focus band) is what keeps that
  // collapse read in the right order (REQ-26) without a separate mobile
  // layout.
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
    gap: 20,
  } satisfies CSSProperties,
  // Per-card slot: wraps exactly ONE grid card (IntentCard or BlastCard) in
  // its own height cap. `minHeight: 0` is NOT set here on purpose — this
  // outer box carries the real min/max — but every descendant between this
  // slot and a card's scroll container (IntentCard's own `card`, BlastCard's
  // `symbolList`) DOES need `minHeight: 0`, or the classic flexbox gotcha
  // applies: a flex item won't shrink below its content size, `maxHeight`
  // becomes a silent no-op, and the card just grows past it with no
  // scrollbar.
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
