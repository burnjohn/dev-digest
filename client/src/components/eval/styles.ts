import type { CSSProperties } from "react";

/** Vertical padding (top + bottom, in px) applied by the shared `td` token
 *  below — kept as a standalone numeric constant (rather than parsing the
 *  `padding` string at runtime) so consumers that need to derive a row
 *  height (e.g. `RecentRunsFeed`'s "10 visible rows" viewport) can compute
 *  it from the SAME source as the actual rendered cell padding, instead of
 *  an independent hand-tuned guess that can silently drift from the real
 *  style. Keep this in sync with `td.padding` above/below whenever it
 *  changes. */
const TD_VERTICAL_PADDING_PX = 16; // "8px 10px" → 8 + 8

/** Approximate line-height (px) of the table's body text at `table.fontSize`
 *  (12.5px), matching the browser default `normal` line-height (~1.2×) for
 *  the font stack used here. Combined with `TD_VERTICAL_PADDING_PX` this
 *  gives a realistic single-row height for viewport-sizing table rows
 *  without introducing a disconnected literal. */
const TD_TEXT_LINE_HEIGHT_PX = 15;

/** A single table body row's rendered height (px): text line-height + the
 *  cell's own vertical padding. Exported so any consumer that needs to size
 *  a scrollable viewport to a fixed number of visible rows (e.g.
 *  `RecentRunsFeed`) derives it from these tokens instead of a hardcoded
 *  guess — see the `td`/`table` tokens this is computed from. */
export const TABLE_ROW_HEIGHT_PX = TD_TEXT_LINE_HEIGHT_PX + TD_VERTICAL_PADDING_PX;

/** Co-located styles for the eval-display components (shared across the
 *  per-agent Evals tab and the cross-agent Eval Dashboard). */
export const s = {
  wrap: { padding: "24px 28px" } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  sectionLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 10,
    marginTop: 28,
  } satisfies CSSProperties,
  note: {
    fontSize: 12,
    color: "var(--text-muted)",
    padding: "8px 12px",
    background: "var(--bg-hover)",
    borderRadius: 6,
    marginBottom: 12,
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
  } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rowName: { fontWeight: 600, fontSize: 13 } satisfies CSSProperties,
  rowSubtitle: {
    fontSize: 11,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  rowActions: { display: "flex", gap: 4, flexShrink: 0 } satisfies CSSProperties,
  // Right-side severity·category / "assert empty" chip on a case row.
  metaChip: {
    fontSize: 11,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap",
    flexShrink: 0,
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
  } satisfies CSSProperties,
  // ---- EVAL METRICS infographic + "N/M passing" badge --------------------
  passingBadge: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--ok)",
    background: "var(--ok-bg)",
    padding: "2px 8px",
    borderRadius: 999,
  } satisfies CSSProperties,
  metricsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  } satisfies CSSProperties,
  metricsTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  dashboardLink: {
    fontSize: 12,
    color: "var(--accent)",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    fontWeight: 600,
  } satisfies CSSProperties,
  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
    marginBottom: 20,
  } satisfies CSSProperties,
  metricCard: {
    padding: "12px 14px",
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
  } satisfies CSSProperties,
  metricLabel: {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  metricValue: {
    fontSize: 24,
    fontWeight: 700,
    lineHeight: 1.1,
  } satisfies CSSProperties,
  iconAction: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 4,
    color: "var(--text-muted)",
    display: "inline-flex",
  } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "8px 10px",
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  td: {
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
  } satisfies CSSProperties,
  batchRow: { cursor: "pointer" } satisfies CSSProperties,
  // Always-visible header above the dashboard Recent-Runs table: section
  // title + selection hint on the left, the Compare button pinned right.
  compareHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  } satisfies CSSProperties,
  compareHeaderLeft: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  compareHeaderTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  } satisfies CSSProperties,
  compareHeaderHint: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  drilldownWrap: {
    padding: "12px 14px",
    background: "var(--bg-hover)",
    borderRadius: 6,
    margin: "6px 0 12px",
  } satisfies CSSProperties,
  caseErrorMessage: {
    marginTop: 4,
    fontSize: 11,
    color: "var(--crit)",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 320,
  } satisfies CSSProperties,
} as const;
