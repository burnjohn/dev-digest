import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView (extracted from inline styles). */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 880, margin: "0 auto" } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 20 } satisfies CSSProperties,
  headerMain: { flex: 1 } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  errorWrap: { marginBottom: 18 } satisfies CSSProperties,
  skeletonStack: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  candidateCount: { fontSize: 13, color: "var(--text-muted)", marginBottom: 16 } satisfies CSSProperties,
} as const;
