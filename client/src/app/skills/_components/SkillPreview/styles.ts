import type { CSSProperties } from "react";

/** Co-located styles for SkillPreview (extracted from inline styles). */
export const s = {
  root: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 18px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  name: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  headerActions: { marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" } satisfies CSSProperties,
  enabledLabel: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: 20 } satisfies CSSProperties,
  untrustedNotice: {
    display: "flex",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    fontSize: 13,
    color: "var(--text-secondary)",
    marginBottom: 16,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  shieldIcon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
