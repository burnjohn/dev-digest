import type { CSSProperties } from "react";

const MONO_FONT = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

export const s = {
  // Unpadded: the two columns own their own padding so the rule between them
  // runs the full height of the body (mockup 7), header border to footer border.
  body: { display: "flex", flexDirection: "column" } satisfies CSSProperties,

  // Kind banner — full-width, above Name, and (red flag) never a control.
  bannerPositive: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--accent)",
    background: "var(--accent-bg)",
    marginBottom: 6,
  } satisfies CSSProperties,
  bannerNegative: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    marginBottom: 6,
  } satisfies CSSProperties,
  bannerLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
  } satisfies CSSProperties,
  bannerLabelPositive: { color: "var(--accent)" } satisfies CSSProperties,
  bannerLabelNegative: { color: "var(--warn)" } satisfies CSSProperties,
  bannerBody: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,

  /* Agent arm: unchanged, mid-left-column. Skill arm: the pinned zone supplies
     the inset, so the margin collapses to a bottom gap only. */
  error: (skill: boolean): CSSProperties => ({
    fontSize: 13,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    borderRadius: 6,
    padding: "8px 12px",
    margin: skill ? "0 0 10px" : "0 0 16px",
  }),

  /* Back to plain objects, identical on both arms.

     The skill arm briefly gave these a computed height so each pane could
     scroll on its own. That produced three scrollbars (body + pane + textarea)
     and, worse, a pane short enough to CLIP the After editor. The rule now is
     the simple one: the columns are sized by their content, nothing inside
     them scrolls, and the Modal body — which is already `flex: 1; overflow:
     auto` — is the single scroller for both sections at once.

     `stretch` (not flex-start) is what lets `colLeft`'s border reach the
     bottom of the taller column instead of stopping at its own content. It
     also hands each column a definite height, which is what lets the skill
     arm's editor region and Actual-output pane grow into the leftover space
     rather than leaving a gap. */
  columns: { display: "flex", alignItems: "stretch" } satisfies CSSProperties,
  colLeft: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "20px 24px",
    borderRight: "1px solid var(--border)",
  } satisfies CSSProperties,
  colRight: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "20px 24px",
  } satisfies CSSProperties,

  /* Skill arm only. The strip below the columns carrying a save error, the run
     verdict and the diff disclosure. It scrolls with everything else — there is
     one scroller now — but it is always the LAST thing, so it can never be
     buried mid-column the way the error used to be. On the agent arm the error
     and the strip stay exactly where they were and this never renders. */
  bottomZone: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    padding: "10px 24px 12px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  tabList: { display: "flex", gap: 4, borderBottom: "1px solid var(--border)", marginBottom: 10 } satisfies CSSProperties,
  tabButton: (active: boolean, disabled: boolean): CSSProperties => ({
    padding: "8px 12px",
    border: "none",
    background: "transparent",
    borderBottom: "2px solid " + (active ? "var(--accent)" : "transparent"),
    marginBottom: -1,
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: disabled ? "var(--text-muted)" : active ? "var(--text-primary)" : "var(--text-secondary)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  }),

  diffBox: {
    fontFamily: MONO_FONT,
    fontSize: 12.5,
    lineHeight: 1.55,
  } satisfies CSSProperties,

  expectedHeaderRight: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,

  // The run-result strip (mockup 7/8): status icon, "Last run passed/failed",
  // then the tally · duration · cost. One row, one tint — the icon inherits
  // `color`, which is why it is not given one of its own.
  lastRunStrip: (pass: boolean | null, skill = false): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    // Skill arm: the pinned zone owns the inset (and the strip is the last
    // thing in it), so it carries no margin of its own.
    margin: skill ? 0 : "0 24px 20px",
    color: pass ? "var(--ok)" : "var(--crit)",
    background: pass ? "var(--ok-bg)" : "var(--crit-bg)",
    border: "1px solid " + (pass ? "var(--ok)" : "var(--crit)"),
  }),
  lastRunLabel: { fontWeight: 600 } satisfies CSSProperties,
  // The separator and the tally sit back from the verdict: same hue, less
  // weight, so "Last run failed" is what the eye lands on first.
  lastRunSeparator: { opacity: 0.6 } satisfies CSSProperties,
  lastRunSummary: { opacity: 0.85 } satisfies CSSProperties,

  /* Agent arm: unchanged. Skill arm: the output takes whatever height the
     column has left after Expected output — including the slack `stretch`
     hands it when the LEFT column is the taller one, which it usually is. That
     is what stops it rendering as the 40px sliver it used to be. */
  actualOutputWrap: { marginTop: 2 } satisfies CSSProperties,
  actualOutputLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 } satisfies CSSProperties,
  actualOutputPre: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 1.5,
    minHeight: 200,
    maxHeight: 260,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  // Same box as `actualOutputPre` — the empty state is a placeholder inside
  // the region, not a differently-shaped element (mockup 7).
  actualOutputEmpty: {
    margin: 0,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-muted)",
    fontSize: 13,
    minHeight: 200,
  } satisfies CSSProperties,

  footer: { display: "flex", alignItems: "center", gap: 12 } satisfies CSSProperties,
  // The save confirmation, beside the Run-on-save toggle. `--ok` is the same
  // hue the passing run strip uses, so "it worked" reads one way in this modal.
  // (Replaces `footerLeft`, which nothing rendered.)
  savedNote: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    fontWeight: 600,
    color: "var(--ok)",
  } satisfies CSSProperties,
  runOnSaveRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  footerRight: { display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" } satisfies CSSProperties,

  disclosureToggle: {
    alignSelf: "flex-start",
    display: "flex",
    alignItems: "center",
    gap: 4,
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    cursor: "pointer",
    padding: "4px 0",
  } satisfies CSSProperties,
  disclosureChevron: (open: boolean): CSSProperties => ({
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .15s ease",
    flexShrink: 0,
  }),
  diffPreview: {
    margin: "4px 0 0",
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 1.5,
    maxHeight: 160,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,

  modalBody: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
} as const;
