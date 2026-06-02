import type { CSSProperties } from "react";

/** Co-located styles for the git-why timeline drawer (extracted from inline styles). */
export const s = {
  title: { display: "inline-flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  titleIcon: { color: "var(--accent)" } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  errorState: { fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
  summary: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: 14 } satisfies CSSProperties,
  emptyState: { fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
  // EventRow
  eventRow: { display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  eventRail: { display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 2 } satisfies CSSProperties,
  eventIcon: (head: boolean): CSSProperties => ({ color: head ? "var(--accent)" : "var(--text-muted)" }),
  eventBody: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  eventSummary: { fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  eventMeta: { fontSize: 12, color: "var(--text-muted)", marginTop: 4, display: "flex", gap: 12 } satisfies CSSProperties,
} as const;
