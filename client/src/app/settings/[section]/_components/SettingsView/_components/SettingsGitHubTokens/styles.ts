import type { CSSProperties } from "react";

/** Co-located styles for SettingsGitHubTokens + its TokenRow. */
export const s = {
  wrap: { maxWidth: 640 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10, marginTop: 4 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  rowLabel: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  rowMeta: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  rowActions: { display: "flex", gap: 8, flexShrink: 0 } satisfies CSSProperties,
  notConfigured: { fontSize: 12, color: "var(--crit)" } satisfies CSSProperties,
  inlineForm: { display: "flex", gap: 8, alignItems: "center", flex: 1 } satisfies CSSProperties,
  confirmBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    fontSize: 13,
    color: "var(--crit)",
  } satisfies CSSProperties,
  createSection: { marginTop: 16, display: "grid", gap: 8 } satisfies CSSProperties,
  result: (ok: boolean): CSSProperties => ({
    fontSize: 12,
    color: ok ? "var(--ok)" : "var(--crit)",
  }),
} as const;
