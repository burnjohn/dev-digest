import type { CSSProperties } from "react";

/** Co-located styles for ConfigTab, including the SkillBodyEditor gutter. */
export const s = {
  header: { display: "flex", alignItems: "center", marginBottom: 20 } satisfies CSSProperties,
  h2: { fontSize: 16, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  enabledLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  notice: {
    display: "flex",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
    marginBottom: 20,
  } satisfies CSSProperties,
  noticeIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 4 } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,

  // ---- SkillBodyEditor ------------------------------------------------------
  editorBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    border: "1px solid var(--border-strong)",
    borderBottom: "none",
    background: "var(--bg-hover)",
  } satisfies CSSProperties,
  filename: {
    fontSize: 12,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  tokenCount: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  editorBody: {
    display: "flex",
    borderBottomLeftRadius: 7,
    borderBottomRightRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    overflow: "hidden",
  } satisfies CSSProperties,
  // Gutter and textarea must share font-size/line-height/padding-top exactly,
  // or line N in the gutter drifts from line N in the text as the body grows.
  gutter: {
    flexShrink: 0,
    padding: "12px 10px 12px 12px",
    textAlign: "right",
    color: "var(--text-muted)",
    fontSize: 13,
    lineHeight: "20px",
    userSelect: "none",
    overflow: "hidden",
    borderRight: "1px solid var(--border)",
  } satisfies CSSProperties,
  textarea: {
    flex: 1,
    minWidth: 0,
    // No wrap: a wrapped line would take more than one visual row, and the
    // gutter (one row per logical line) would drift out of alignment with it.
    whiteSpace: "pre",
    overflow: "auto",
    resize: "vertical",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--text-primary)",
    padding: 12,
    fontSize: 13,
    lineHeight: "20px",
  } satisfies CSSProperties,
} as const;
