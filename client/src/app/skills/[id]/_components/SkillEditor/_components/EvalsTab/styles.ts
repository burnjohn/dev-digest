import type { CSSProperties } from "react";

/** Co-located styles for the skill editor's EvalsTab.
 *
 * WIDTH: this tab is deliberately FLUID — no `maxWidth` — so it fills the
 * editor body the way the agent tab does. It diverges from its own siblings
 * (ConfigTab/ContextTab/PreviewTab/VersionsTab all cap at 860, which suits a
 * column of form fields), because a case row is a wide object: name, pill,
 * result line, severity meta and a three-control action cluster all compete
 * for one line, and a cap forces them to wrap on a screen with room to spare.
 * `SkillEditor/styles.ts` `body` supplies NO padding of its own (unlike
 * `AgentEditor`, whose body pads 28), so this wrap must keep supplying its own.
 *
 * REFLOW: there are no media queries anywhere in this client — styles are
 * inline objects — so narrow-width behaviour is INTRINSIC: `flexWrap` plus a
 * `flex-basis` on the one column allowed to shrink. Nothing here truncates
 * with an ellipsis; a long case name wraps (`overflowWrap: "anywhere"`) rather
 * than being cut off, since the name is the only way to tell two rows apart.
 */
export const s = {
  wrap: {
    padding: "24px 28px 44px",
    display: "flex",
    flexDirection: "column",
    gap: 18,
  } satisfies CSSProperties,
  // `flexWrap` so the action cluster drops onto its own line rather than
  // crushing the heading on a narrow pane; `marginLeft: auto` on the actions
  // keeps them right-aligned until that happens.
  header: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
  } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
    flexShrink: 0,
  } satisfies CSSProperties,
  loadingHeader: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  // The batch progress line, matching the agent tab's own `progress` style.
  progress: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    borderRadius: 7,
    padding: "8px 12px",
  } satisfies CSSProperties,
  list: {
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 0,
    margin: 0,
  } satisfies CSSProperties,
  // The marker + name column is the only part allowed to shrink; the severity
  // meta and the action cluster wrap onto a second line rather than compress.
  // The `spacer` before the meta is what keeps them right-aligned while there
  // is room, and collapses to nothing once the row wraps.
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
  resultLine: { fontSize: 12, color: "var(--text-muted)", overflowWrap: "anywhere" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  // Severity + category as quiet right-hand metadata, not a filled badge: the
  // pill on the name line owns the row's one piece of colour, and two
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
  modalBody: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    padding: "18px 24px",
  } satisfies CSSProperties,
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
