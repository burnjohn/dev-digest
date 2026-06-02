import type { CSSProperties } from "react";

/** Co-located styles for MemoryCard (extracted from inline styles). */
export const s = {
  card: (active: boolean): CSSProperties => ({
    padding: 16,
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid " + (active ? "var(--border-strong)" : "var(--border)"),
    background: active ? "var(--bg-hover)" : "var(--bg-elevated)",
  }),
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 } satisfies CSSProperties,
  kindChip: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    fontWeight: 600,
    color,
    background: color + "1a",
    padding: "2px 8px",
    borderRadius: 4,
    textTransform: "capitalize",
  }),
  scopeBadgeBorder: (color: string): CSSProperties => ({ border: "1px solid " + color }),
  confidence: { marginLeft: "auto" } satisfies CSSProperties,
  content: { fontSize: 14, lineHeight: 1.5, color: "var(--text-primary)" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" } satisfies CSSProperties,
  prTag: {
    fontSize: 12,
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "1px 8px",
    borderRadius: 4,
  } satisfies CSSProperties,
  usedAt: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
