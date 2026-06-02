import type { CSSProperties } from "react";

/** Co-located styles for the PluginsSection (Settings → Plugins & Digest). */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  intro: { fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 } satisfies CSSProperties,
  actionsRow: { display: "flex", gap: 10, marginBottom: 14 } satisfies CSSProperties,
  hiddenInput: { display: "none" } satisfies CSSProperties,
  textarea: {
    width: "100%",
    fontSize: 13,
    fontFamily: "var(--font-mono, monospace)",
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    resize: "vertical",
  } satisfies CSSProperties,
  importRow: { marginTop: 10 } satisfies CSSProperties,
  section: { marginTop: 30 } satisfies CSSProperties,
  installedList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  installedRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 13,
  } satisfies CSSProperties,
  installedName: { fontWeight: 600, flex: 1 } satisfies CSSProperties,
  digestCard: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
  } satisfies CSSProperties,
} as const;
