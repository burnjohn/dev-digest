import type { CSSProperties } from "react";

const MONO_FONT = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

/** Co-located styles for ConventionCard. */
export const s = {
  // A plain container, never a <button>: it holds the accept/reject buttons and
  // the edit control (see client/INSIGHTS.md — nesting interactive elements is
  // invalid HTML the parser breaks apart).
  card: (rejected: boolean): CSSProperties => ({
    display: "flex",
    gap: 16,
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 12,
    // A rejected rule stays visible (it is the dedup memory, and un-rejecting is
    // one click) but recedes.
    opacity: rejected ? 0.55 : 1,
  }),
  main: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  // The category used to be a section heading. The list is ranked by confidence
  // now, so it rides on the card instead.
  chipRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  } satisfies CSSProperties,
  chip: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: 999,
    padding: "2px 8px",
  } satisfies CSSProperties,
  configChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--ok)",
    border: "1px solid var(--ok)",
    borderRadius: 999,
    padding: "2px 8px",
  } satisfies CSSProperties,
  rule: {
    fontSize: 14,
    fontWeight: 600,
    fontStyle: "italic",
    lineHeight: 1.45,
    margin: 0,
  } satisfies CSSProperties,
  rationale: {
    fontSize: 12.5,
    color: "var(--text-muted)",
    margin: "6px 0 0",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  evidenceBox: {
    marginTop: 12,
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  evidenceHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-hover)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  evidenceRef: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "10px 12px",
    fontFamily: MONO_FONT,
    fontSize: 12.5,
    lineHeight: "20px",
    color: "var(--text-primary)",
    // A quoted code fragment must not be re-wrapped into something that never
    // appeared in the file; scroll the overflow instead.
    whiteSpace: "pre",
    overflowX: "auto",
    // Focusable so the horizontal scroll is reachable without a pointer.
    outlineOffset: -2,
  } satisfies CSSProperties,
  meterRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  } satisfies CSSProperties,
  meterLabel: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  meterTrack: { width: 120 } satisfies CSSProperties,
  meterValue: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  support: { fontSize: 12, color: "var(--text-muted)", marginLeft: 4 } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
    width: 132,
  } satisfies CSSProperties,
  editStack: { display: "grid", gap: 10 } satisfies CSSProperties,
  editLabel: {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 4,
  } satisfies CSSProperties,
  editSnippet: {
    width: "100%",
    minHeight: 72,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontFamily: MONO_FONT,
    fontSize: 12.5,
    lineHeight: "20px",
    resize: "vertical",
  } satisfies CSSProperties,
  editActions: { display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
