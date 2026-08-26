import type { CSSProperties } from "react";

/** Co-located styles for BOTH halves of the brief:

    - `section` / `card` / `what` / `why` / the verdict and side columns —
      PrBriefCard, the
      full-width BAND above the Overview grid. It is NOT inside a height-capped
      `cardSlot`, so it mirrors ReviewFocusCard/styles.ts: no `flex: 1 1 auto`,
      no `minHeight: 0`, no inner scroll container. Content height, full width.
    - `riskSection` and everything below it — RiskAreas, which renders INSIDE
      IntentCard's card. Nothing here draws a border or a background: the
      surrounding card already does, and a nested box would read as a second
      card.

    Per-side border longhands only where a `borderLeftColor` accent could
    conflict with the `border` shorthand (client/INSIGHTS.md 2026-08-10). */
export const s = {
  // Root `<section>` of the band. Mirrors ReviewFocusCard/styles.ts `section`
  // — the two full-width bands top and bottom of the Overview tab behave
  // identically, and neither is height-capped.
  section: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  // ONE box for the whole band (mockup 1): the verdict icon, the main column
  // (headline + the brief's prose) and the side column (Recalculate, score
  // ring, cost strip) are three flex children of it — not a card inside a
  // card. `alignItems: flex-start` keeps the icon and the ring pinned to the
  // top as the prose grows.
  card: {
    display: "flex",
    gap: 18,
    alignItems: "flex-start",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  // The loading branch has no columns to lay out — plain block box.
  loadingCard: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
  } satisfies CSSProperties,
  verdictIconBox: (bg: string, color: string): CSSProperties => ({
    width: 40,
    height: 40,
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 10,
  } satisfies CSSProperties,
  verdictLabel: (color: string): CSSProperties => ({
    fontSize: 18,
    fontWeight: 700,
    color,
  }),
  // The ⓘ explaining that the headline is derived from the blocker count.
  // Muted so it reads as an affordance, not as a severity signal sitting next
  // to the findings count.
  derivedNote: {
    display: "inline-flex",
    alignItems: "center",
    color: "var(--text-muted)",
    flexShrink: 0,
    cursor: "help",
  } satisfies CSSProperties,
  // Recalculate, then the ring, then the cost line — right-aligned, in the
  // order mockup 1 stacks them.
  sideCol: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,
  scoreBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
  } satisfies CSSProperties,
  scoreLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
  } satisfies CSSProperties,
  /** `$0.014 · 31K→1.2K`. `whiteSpace: nowrap` keeps the arrow on the number
      it belongs to when the column is narrow. */
  costStrip: {
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
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
  // RiskAreas' error branch: the same row WITHOUT the card box, since it
  // renders inside IntentCard's card (see the file header).
  errorRow: {
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
  loadingText: {
    marginTop: 12,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  // The "Built without …" note (REQ-32/REQ-40/REQ-43). Same shape as
  // IntentCard's `staleNotice` / BlastCard's `banner` so the three read as
  // one system across the Overview tab.
  note: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    padding: "8px 12px",
    borderRadius: 6,
    marginBottom: 14,
    flexShrink: 0,
  } satisfies CSSProperties,
  noteIcon: { flexShrink: 0, color: "var(--text-muted)" } satisfies CSSProperties,
  // NO `maxWidth` on either paragraph — deliberate, owner decision 2026-08-27,
  // reversing the `78ch` measure cap that used to be here. The cap was applied
  // to text sitting in a `flex: 1` column beside a `flexShrink: 0` side column,
  // so at 14px it stopped the prose ~590px into an ~880px column and left a
  // visible hole between the text and the score ring. The measure is bounded
  // anyway by the page container (1080px) less the verdict icon and the side
  // column; the hole was the worse of the two trades.
  //
  // `main` carries `minWidth: 0`, which is what lets the prose compress on a
  // narrow window instead of pushing into the ring.
  //
  // `what` leads and `why` supports it, so they are not the same paragraph
  // twice: primary text at 14px against secondary at 13px. The risk-level
  // badge that used to sit above them was removed by owner decision
  // (2026-08-26) — the verdict headline is the band's severity signal now.
  what: {
    margin: "0 0 8px",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  why: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  // --- RiskAreas, inside IntentCard's card -------------------------------
  riskSection: {
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  // Matches IntentCard/styles.ts `scopeLabel` (size/weight/tracking/colour) so
  // RISK AREAS reads as a third peer of IN SCOPE / OUT OF SCOPE, plus the
  // leading warning glyph both mockups draw.
  risksLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  risksLabelIcon: { flexShrink: 0 } satisfies CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "4px 0",
  } satisfies CSSProperties,
  // A plain column, NOT a scroll container: IntentCard's own card is the
  // scroller now (IntentCard/styles.ts `card` — `overflowY: auto`), and a
  // second nested scroll area inside one height-capped slot would trap the
  // wheel over the rows.
  riskList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  riskWrap: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    // The enclosing card is a height-capped `flexDirection: column`, which
    // defaults its children to `flex-shrink: 1` — that compresses rows toward
    // zero height instead of letting the card scroll (BlastCard/styles.ts
    // `symbolWrap`, client/INSIGHTS.md 2026-08-26).
    flexShrink: 0,
  } satisfies CSSProperties,
  // The disclosure trigger: the TITLE row alone. It stopped being the whole
  // two-line row when the file path became a link — an `<a>` inside a
  // `<button>` is nested interactive content (client/INSIGHTS.md 2026-08-16).
  riskHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 10px 2px",
    background: "transparent",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    fontSize: 13,
    color: "inherit",
    font: "inherit",
  } satisfies CSSProperties,
  riskIcon: (color: string): CSSProperties => ({ color, flexShrink: 0 }),
  riskTitle: {
    flex: 1,
    minWidth: 0,
    color: "var(--text-primary)",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  riskChevron: (expanded: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
    transition: "transform .15s",
    flexShrink: 0,
  }),
  // Sibling of the trigger, not a child. The left padding restores the
  // alignment the button used to give it: 10px of row padding + 22px past the
  // severity icon.
  riskFileRow: {
    display: "flex",
    padding: "0 10px 8px 32px",
    minWidth: 0,
  } satisfies CSSProperties,
  // Left-truncation trick (SPEC-02 "Non-functional requirements" —
  // Accessibility): `direction: rtl` + `text-align: left` overflows off the
  // START of the string instead of the end, so the filename stays visible.
  // `minWidth: 0` is mandatory on both this and its flex ancestor
  // (`riskFileRow`) or the ellipsis silently never triggers.
  //
  // Two variants, exactly like ReviewFocusCard: a link when the row can be
  // resolved to a blob URL, plain muted text when it cannot. `:hover` is
  // impossible in an inline style, hence the `hovered` parameter.
  fileLink: (hovered: boolean): CSSProperties => ({
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl",
    textAlign: "left",
    fontSize: 12,
    color: "var(--accent-text)",
    textDecoration: hovered ? "underline" : "none",
    textUnderlineOffset: 2,
  }),
  // The no-href degradation: plain, non-interactive text — never `MonoLink`'s
  // dead `<button>` (client/INSIGHTS.md 2026-08-17).
  filePlain: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl",
    textAlign: "left",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  riskBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 10px 12px 30px",
  } satisfies CSSProperties,
  // Kept in the DOM (never unmounted) so `aria-controls` always resolves —
  // see the comment at its one call site in RiskAreas.tsx.
  riskBodyHidden: {
    display: "none",
  } satisfies CSSProperties,
  riskExplanation: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
} as const;
