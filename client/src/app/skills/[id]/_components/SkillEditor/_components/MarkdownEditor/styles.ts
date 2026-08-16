import type { CSSProperties } from "react";

const MONO_FONT = "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
const LINE_HEIGHT = 20;
const FONT_SIZE = 12.5;

export const EDITOR_METRICS = { LINE_HEIGHT, FONT_SIZE, MONO_FONT };

export const s = {
  wrap: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  headerStrip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 12,
  } satisfies CSSProperties,
  fileName: { color: "var(--text-secondary)" } satisfies CSSProperties,
  unsaved: {
    fontSize: 11,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "1px 7px",
    borderRadius: 4,
  } satisfies CSSProperties,
  tokens: { marginLeft: "auto", color: "var(--text-muted)", fontSize: 11 } satisfies CSSProperties,
  tokensOver: { marginLeft: "auto", color: "var(--crit)", fontSize: 11 } satisfies CSSProperties,
  // The gutter and the textarea scroll as one: the gutter is translated by the
  // textarea's scrollTop rather than being its own scroll container, so the two
  // can never disagree.
  body: {
    display: "flex",
    position: "relative",
    maxHeight: 460,
    overflow: "hidden",
  } satisfies CSSProperties,
  gutter: {
    flexShrink: 0,
    padding: "10px 8px 10px 12px",
    textAlign: "right",
    userSelect: "none",
    color: "var(--text-muted)",
    background: "var(--bg-surface)",
    borderRight: "1px solid var(--border)",
    fontFamily: MONO_FONT,
    fontSize: FONT_SIZE,
    lineHeight: `${LINE_HEIGHT}px`,
    overflow: "hidden",
  } satisfies CSSProperties,
  gutterInner: (offset: number): CSSProperties => ({
    transform: `translateY(${-offset}px)`,
  }),
  textarea: {
    flex: 1,
    minWidth: 0,
    padding: "10px 12px",
    border: "none",
    outline: "none",
    resize: "vertical",
    minHeight: 260,
    maxHeight: 460,
    background: "transparent",
    color: "var(--text-primary)",
    fontFamily: MONO_FONT,
    fontSize: FONT_SIZE,
    lineHeight: `${LINE_HEIGHT}px`,
    tabSize: 2,
    whiteSpace: "pre",
    overflowWrap: "normal",
  } satisfies CSSProperties,
} as const;
