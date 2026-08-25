import type { CSSProperties } from "react";

/** Co-located styles for BlastCard. Mirrors IntentCard/FindingCard: a
    bordered `bg-elevated` card under a SectionLabel header, per-side border
    longhands only where a `borderLeftColor` accent could conflict
    (client/INSIGHTS.md 2026-08-10) — this card has none, so plain `border`
    shorthands are safe throughout. */
export const s = {
  // Root `<section>` — the sole child of OverviewTab's `cardSlot`
  // (OverviewTab/styles.ts), itself a flex column. `flex: "1 1 auto"` grows
  // this to fill the slot's full height (more robust than `height: "100%"`
  // for a flex item whose container's own height comes from grid stretch
  // rather than an explicit `height`). `minHeight: 0` is what lets it shrink
  // below its content size — without it the slot's `maxHeight` is a silent
  // no-op (see `symbolList` below, the actual scroll container). Applied to
  // every returned `<section>` (loading, error, main) so the card fills its
  // slot in all three states.
  section: {
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minHeight: 0,
  } satisfies CSSProperties,
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    // Fills the remaining space under SectionLabel inside `section`, and
    // must ALSO carry `minHeight: 0` to keep the shrink-to-fit chain intact
    // down to `symbolList`'s `overflowY: auto`.
    display: "flex",
    flexDirection: "column",
    flex: "1 1 auto",
    minHeight: 0,
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
  /** Non-`ok` status banner (REQ-16). Same shape as DiffTab's `notice` /
      IntentCard's `staleNotice` so the three read as one system. */
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "8px 12px",
    borderRadius: 6,
    marginBottom: 14,
    // Stays pinned at natural size above the scrolling `symbolList` — never
    // squeezed by the flex column's default shrink.
    flexShrink: 0,
  } satisfies CSSProperties,
  bannerIcon: { flexShrink: 0 } satisfies CSSProperties,
  bannerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  // T10/REQ-19 — the optional narration paragraph. Mirrors IntentCard's
  // italic quote block (`IntentCard/styles.ts` `summary`): border LONGHANDS
  // only (`borderLeftWidth/Style/Color`), never the `border` shorthand
  // alongside them — that pairing is the exact React rerender-warning trap
  // logged in client/INSIGHTS.md 2026-08-10.
  narrativeWrap: {
    marginBottom: 16,
    // Pinned above the scrolling `symbolList` — see `banner` above.
    flexShrink: 0,
  } satisfies CSSProperties,
  narrativeLabel: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  narrativeLabelIcon: { flexShrink: 0 } satisfies CSSProperties,
  narrativeText: {
    margin: 0,
    fontSize: 13,
    fontStyle: "italic",
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: "var(--border-strong)",
    paddingLeft: 12,
  } satisfies CSSProperties,
  statsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 16,
    // The count strip stays pinned above the scrolling `symbolList` — see
    // `banner` above.
    flexShrink: 0,
  } satisfies CSSProperties,
  stats: {
    display: "flex",
    alignItems: "center",
    gap: 18,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  statItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  statIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  statValue: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  // The chosen scroll container (see the report for why: this keeps the
  // count strip, status banner and Prior PRs accordion pinned and usable
  // while only the list itself moves underneath them).
  // `minHeight: 0` is what lets this flex item shrink below its content
  // size at all — omit it and `maxHeight` on the OverviewTab slot becomes a
  // silent no-op with no scrollbar (the classic flexbox gotcha).
  symbolList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flex: "1 1 auto",
    minHeight: 0,
    overflowY: "auto",
  } satisfies CSSProperties,
  symbolWrap: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    // `symbolList` is a height-capped `flexDirection: column` scroll
    // container, so its children default to `flex-shrink: 1` and compress
    // toward zero height instead of overflowing — the rows render as thin
    // empty bars and the scrollbar never appears (the `overflow: hidden`
    // above then clips the text away silently rather than failing loudly).
    // A scroll container only scrolls when its content may exceed it.
    flexShrink: 0,
  } satisfies CSSProperties,
  // The "Show all N symbols" expander — sits below the capped slice inside
  // the same `symbolList` gap column, styled like a text link rather than a
  // boxed button so it reads as "more of the same list", not a new action.
  showAllButton: {
    alignSelf: "flex-start",
    background: "none",
    border: "none",
    padding: "4px 2px",
    color: "var(--accent)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    // Direct child of the scrolling `symbolList` — see `symbolWrap`.
    flexShrink: 0,
  } satisfies CSSProperties,
  // Caller-list truncation disclosure — a symbol can have more callers than
  // fit in the (server-capped) `callers[]` array; `caller_count` stays the
  // honest pre-cap total. Sits alongside the caller rows, same tone as
  // `heuristicNote`.
  callerTruncatedNote: {
    marginTop: 2,
    fontSize: 11,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  // `interactive=false` when a row has no callers AND no chips — nothing to
  // expand into, so the header degrades to a plain non-clickable row rather
  // than a stray affordance that opens onto an empty void.
  symbolHeader: (interactive: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    background: "transparent",
    border: "none",
    textAlign: "left",
    cursor: interactive ? "pointer" : "default",
    fontSize: 13,
  }),
  symbolChevron: (expanded: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
    transition: "transform .15s",
    flexShrink: 0,
  }),
  // Keeps the symbol name aligned with expandable rows when the chevron is
  // omitted for a non-expandable row (14px matches the ChevronDown icon).
  symbolChevronSpacer: { width: 14, flexShrink: 0 } satisfies CSSProperties,
  symbolIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  symbolName: {
    flex: 1,
    minWidth: 0,
    color: "var(--text-primary)",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  callerBadge: {
    flexShrink: 0,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  symbolBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 10px 12px 30px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  callerIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  } satisfies CSSProperties,
  // Blue, matching the mockup's endpoint chips.
  endpointChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 9px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
  } satisfies CSSProperties,
  // Amber, matching the mockup's cron chip — visually distinct from endpoints.
  cronChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 9px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--warn)",
    background: "var(--warn-bg)",
  } satisfies CSSProperties,
  heuristicNote: {
    marginTop: 4,
    fontSize: 11,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "4px 0",
  } satisfies CSSProperties,
  // The demoted "no downstream callers" note (bug fix: this used to replace
  // the whole symbol list — see BlastCard.tsx). Sits ABOVE the rows, not in
  // place of them, so `symbols[]`'s own chips (endpoints/crons) stay visible.
  noDownstreamNote: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
    padding: "2px 2px 6px",
    // Direct child of the scrolling `symbolList` — see `symbolWrap`.
    flexShrink: 0,
  } satisfies CSSProperties,
  // T8 — "Prior PRs touching these files" accordion. Collapsed by default;
  // the header is a plain <button> with no interactive descendants (rows
  // with links live in the body, opened only on expand).
  priorPrsWrap: {
    marginTop: 14,
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    // Pinned below the scrolling `symbolList`, at its own natural height —
    // never squeezed by the flex column's default shrink.
    flexShrink: 0,
  } satisfies CSSProperties,
  priorPrsHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    background: "transparent",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    fontSize: 13,
  } satisfies CSSProperties,
  priorPrsIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  priorPrsTitle: {
    flex: 1,
    minWidth: 0,
    color: "var(--text-primary)",
    fontWeight: 600,
  } satisfies CSSProperties,
  priorPrsCount: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    padding: "1px 7px",
    borderRadius: 10,
    background: "var(--bg-hover)",
  } satisfies CSSProperties,
  priorPrsUnavailable: {
    flexShrink: 0,
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,
  priorPrsChevron: (expanded: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
    transition: "transform .15s",
    flexShrink: 0,
  }),
  priorPrsBody: {
    borderTop: "1px solid var(--border)",
    padding: "6px 10px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,
  priorPrRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 4px",
    borderRadius: 4,
    color: "inherit",
    textDecoration: "none",
  } satisfies CSSProperties,
  priorPrNumber: {
    flexShrink: 0,
    color: "var(--text-muted)",
    fontSize: 12,
  } satisfies CSSProperties,
  priorPrTitle: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  priorPrOverlap: {
    flexShrink: 0,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
