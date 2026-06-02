import type { CSSProperties } from "react";

/** Co-located styles for the Multi-Agent Review page (extracted from inline styles). */
export const s = {
  header: {
    padding: "20px 32px 5px",
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  headerActions: { marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" } satisfies CSSProperties,
  viewSwitch: {
    display: "flex",
    gap: 2,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: 2,
  } satisfies CSSProperties,
  viewBtn: (active: boolean): CSSProperties => ({
    padding: "5px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 5,
    border: "none",
    textTransform: "capitalize",
    cursor: "pointer",
    background: active ? "var(--bg-elevated)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
  }),
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "16px 32px",
    borderBottom: "1px solid var(--border)",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  metaPr: { color: "var(--text-muted)" } satisfies CSSProperties,
  metaTitle: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  metaAside: { marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  metaIcon: { color: "var(--accent)" } satisfies CSSProperties,
  loadingPad: { padding: "24px 32px", display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  emptyPad: { padding: "24px 32px" } satisfies CSSProperties,
} as const;
