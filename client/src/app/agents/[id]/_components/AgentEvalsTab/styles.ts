import type { CSSProperties } from "react";

/** Co-located styles for AgentEvalsTab. */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 24 } satisfies CSSProperties,
  casesHead: { display: "flex", alignItems: "center", marginBottom: 14 } satisfies CSSProperties,
  casesTitle: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  newCaseWrap: { marginLeft: "auto" } satisfies CSSProperties,
  loading: { fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
  empty: {
    border: "1px dashed var(--border-strong)",
    borderRadius: 8,
    padding: 28,
    textAlign: "center",
    fontSize: 14,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
