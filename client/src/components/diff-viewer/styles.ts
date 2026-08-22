import type { CSSProperties } from "react";
import type { Severity } from "@devdigest/shared";
import { SEV } from "@devdigest/ui";
import type { Line } from "./helpers";

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  /** Wraps the path + REQ-29 header indicator so the dot sits right after the
   *  path (per the mockup, §5.8) rather than drifting to the far right. */
  filePathRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: "0 1 auto",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12, flexShrink: 0 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
  /** REQ-16 — "not on a visible line" findings, rendered under the header
   *  regardless of the card's open/closed state. */
  orphanList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "0 12px 10px",
  } satisfies CSSProperties,
} as const;

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/**
 * Row background per line kind (add/del tinted, others transparent), plus the
 * coloured left bar for an on-line finding annotation (REQ-14/15). Deliberately
 * sets ONLY the three non-left border longhands, never the `borderColor`
 * shorthand — see client/INSIGHTS.md 2026-08-10 (a shorthand alongside
 * `borderLeftColor` triggers React's "conflicting style property" warning on
 * re-render).
 */
export function lineRowFor(kind: Line["kind"], annotationColor?: string): CSSProperties {
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  const base: CSSProperties = {
    display: "flex",
    alignItems: "stretch",
    fontSize: 13,
    lineHeight: "20px",
    background,
  };
  if (!annotationColor) return base;
  return {
    ...base,
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: annotationColor,
  };
}

/** The accent colour for a given severity — the single source both the left
 *  bar (`lineRowFor`) and the chip/dot helpers below draw from. */
export function severityColor(severity: Severity): string {
  return SEV[severity].c;
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}

/** The clickable chip a `DiffLineAnnotation` renders as — on a code line, in a
 *  file header, or in the orphan list. Colour comes from severity; the text is
 *  always the caller-supplied `label` (never a literal here). */
export function annotationChip(severity: Severity): CSSProperties {
  const sev = SEV[severity];
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "1px 7px",
    borderRadius: 5,
    fontSize: 11,
    fontWeight: 600,
    color: sev.c,
    background: sev.bg,
    border: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  };
}

/** Small coloured dot placed right after a file path (REQ-29, mockup §5.8). */
export function annotationDot(severity: Severity): CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: 99,
    background: severityColor(severity),
    display: "inline-block",
    flexShrink: 0,
  };
}

/** Right-aligned on-line chip position (CodeLine). */
export const annotationChipSlot: CSSProperties = {
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  paddingRight: 8,
};

/** One clickable row in the "not on a visible line" orphan list. */
export const orphanItem: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  color: "var(--text-muted)",
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 0,
  textAlign: "left",
  width: "fit-content",
};
