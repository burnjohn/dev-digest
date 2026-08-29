import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab.
 *
 * WIDTH: this tab is deliberately FLUID — no `maxWidth` — so it fills the
 * editor body the way the full-width header and `Tabs` bar above it do.
 * Note `AgentEditor/styles.ts` `body` already applies `padding: 28`, so this
 * wrap must NOT add horizontal padding of its own (`ConfigTab` is the sibling
 * that gets this right; `ContextTab`/`SkillsTab` still double up). It only
 * tops up the bottom gutter.
 *
 * REFLOW: there are no media queries anywhere in this client — styles are
 * inline objects. Narrow-width behaviour is therefore INTRINSIC, using the
 * same `repeat(auto-fit, minmax(…))` pattern documented in
 * `pulls/[number]/_components/IntentCard/styles.ts` and `OverviewTab/styles.ts`.
 */
export const s = {
  wrap: { paddingBottom: 16 } satisfies CSSProperties,
  section: { marginBottom: 28 } satisfies CSSProperties,
  metricsHeader: { marginBottom: 4 } satisfies CSSProperties,
  metricsSubtitle: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    marginBottom: 14,
  } satisfies CSSProperties,
  // Four cards while there is room for them, folding to 3/2/1 as the pane
  // narrows. `auto-fit` (not `auto-fill`) so the surviving columns stretch to
  // fill the row instead of leaving an empty track at wide widths.
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 10,
  } satisfies CSSProperties,
  metricCard: {
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    minWidth: 0,
  } satisfies CSSProperties,
  metricLabel: {
    display: "block",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  metricValue: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  dashboardLink: {
    display: "inline-flex",
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent)",
    textDecoration: "none",
    marginTop: 10,
  } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
    flexShrink: 0,
  } satisfies CSSProperties,
  progress: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    borderRadius: 7,
    padding: "8px 12px",
    marginBottom: 12,
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  // The marker + name column is the only part allowed to shrink; the badges
  // and the action cluster wrap onto a second line rather than compress. The
  // `spacer` before `rowMeta` is what keeps them right-aligned while there is
  // room, and collapses to nothing once the row wraps.
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  marker: (color: string): CSSProperties => ({ display: "inline-flex", color, flexShrink: 0 }),
  // `ddspin` is the kit's own keyframes (vendor/ui/styles.css, imported once
  // globally) — the SAME animation `Button loading` applies, so a running
  // row's marker and its button spin in step rather than at two rates.
  spin: { animation: "ddspin 1s linear infinite" } satisfies CSSProperties,
  rowBody: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 200px" } satisfies CSSProperties,
  // The name and its expectation pill share the row's FIRST line, so the pill
  // reads as part of the case's title rather than as right-hand metadata.
  // `flexWrap` lets the pill drop under a long name instead of squeezing it.
  nameLine: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, minWidth: 0 } satisfies CSSProperties,
  name: { fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" } satisfies CSSProperties,
  resultLine: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  // Severity + category as quiet right-hand metadata, not a filled badge: the
  // pill on the name line now owns the row's one piece of colour, and two
  // saturated chips on one row compete for the same glance.
  severityMeta: {
    fontSize: 11.5,
    fontWeight: 500,
    color: "var(--text-muted)",
    letterSpacing: "0.02em",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,
  rowActions: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 } satisfies CSSProperties,
  // The MUST FIND / MUST NOT FLAG pill: blue for `must_find`, green for
  // `must_not_flag`. Text-only by design — no glyph — and the text is what
  // carries the meaning, so the colour is decoration and WCAG AA's
  // never-colour-alone rule is satisfied without an icon.
  expectationPill: (color: string, bg: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 7px",
    borderRadius: 4,
    color,
    background: bg,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    flexShrink: 0,
  }),
} as const;
