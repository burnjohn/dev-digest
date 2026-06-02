import type { CSSProperties } from "react";

/** Co-located styles for ConformanceReport (extracted from inline styles). */
export const s = {
  loading: { padding: 28, fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
  emptyWrap: { padding: 10 } satisfies CSSProperties,
  emptyAction: { display: "flex", justifyContent: "center", marginTop: 14 } satisfies CSSProperties,
  emptyError: { textAlign: "center", marginTop: 12, fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
  root: { maxWidth: 1040 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 18, marginBottom: 24 } satisfies CSSProperties,
  headerMain: { flex: 1 } satisfies CSSProperties,
  h2: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  comparing: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  prNumber: { color: "var(--accent-text)" } satisfies CSSProperties,
  scoreWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 5 } satisfies CSSProperties,
  scoreLabel: { fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.04em" } satisfies CSSProperties,
  columns: { display: "flex", gap: 20 } satisfies CSSProperties,
} as const;
