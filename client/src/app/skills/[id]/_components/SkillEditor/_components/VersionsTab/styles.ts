import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: "24px 28px 44px", maxWidth: 860 } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    marginTop: 4,
    marginBottom: 18,
  } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  list: { listStyle: "none", display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  item: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  // Was one `itemHeader` on the toggle <button> itself. Split in two so the
  // Restore button can be a SIBLING of the toggle rather than nested inside it
  // (a button in a button is invalid HTML and a hydration error). `row` keeps
  // the padding/border/gap; `toggle` is the borderless, flex-filling hit area.
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
  } satisfies CSSProperties,
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0, // lets `message` ellipsize instead of stretching the row
    padding: 0,
    background: "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  version: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  message: {
    fontSize: 12,
    color: "var(--text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  // `marginLeft: auto` still pushes the date right — it now does so inside
  // `toggle` rather than the whole row, which is what keeps Restore at the end.
  date: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  chars: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  modalBody: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    padding: "18px 24px",
  } satisfies CSSProperties,
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
  body: {
    margin: 0,
    padding: "12px 14px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 12,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: 320,
    overflow: "auto",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
