import type { CSSProperties } from "react";

/** Co-located styles for AgentCiTab. */
export const s = {
  header: { display: "flex", alignItems: "center", marginBottom: 18 } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  actions: { marginLeft: "auto" } satisfies CSSProperties,
  empty: {
    border: "1px dashed var(--border-strong)",
    borderRadius: 8,
    padding: 28,
    textAlign: "center",
    fontSize: 14,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  installRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  installIcon: { color: "var(--accent)" } satisfies CSSProperties,
  installBody: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  installedAt: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
} as const;
