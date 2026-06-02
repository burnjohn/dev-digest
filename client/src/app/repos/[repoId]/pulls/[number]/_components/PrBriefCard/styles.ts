import type { CSSProperties } from "react";

/** Co-located styles for the PR Brief Card (extracted from inline styles). */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  // Block
  block: { borderTop: "1px solid var(--border)", paddingTop: 16 } satisfies CSSProperties,
  blockHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 } satisfies CSSProperties,
  blockIcon: { color: "var(--accent)" } satisfies CSSProperties,
  blockTitle: { fontSize: 14, fontWeight: 650 } satisfies CSSProperties,
  blockRight: { marginLeft: "auto" } satisfies CSSProperties,
  // Intent
  intentText: { fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55 } satisfies CSSProperties,
  chipRow: { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" } satisfies CSSProperties,
  // Risk row
  riskRow: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  riskHeader: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  riskTitle: { fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  riskKind: { marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  riskExplanation: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  riskFileRefs: { display: "flex", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  riskFileRef: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  risksList: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  // History row
  historyRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "10px 0",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  historyIcon: { color: "var(--text-muted)", marginTop: 2, flexShrink: 0 } satisfies CSSProperties,
  historyBody: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  historyTitleLine: { fontSize: 13 } satisfies CSSProperties,
  historyPrNum: { color: "var(--text-muted)" } satisfies CSSProperties,
  historyTitle: { fontWeight: 600 } satisfies CSSProperties,
  historyMeta: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  // states
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  errorState: { fontSize: 13, color: "var(--text-muted)", padding: 14 } satisfies CSSProperties,
  loadingStack: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
