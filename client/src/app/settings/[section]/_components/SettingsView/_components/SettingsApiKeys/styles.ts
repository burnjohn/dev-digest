import type { CSSProperties } from "react";

/** Co-located styles for SettingsApiKeys + its KeyRow. */
export const s = {
  wrap: { maxWidth: 640 } satisfies CSSProperties,
  keyRow: { display: "flex", gap: 10, alignItems: "center" } satisfies CSSProperties,
  keyInput: { flex: 1 } satisfies CSSProperties,
  revealIcon: { color: "var(--text-muted)", cursor: "pointer" } satisfies CSSProperties,
  result: (ok: boolean): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    fontSize: 13,
    color: ok ? "var(--ok)" : "var(--crit)",
    fontWeight: 600,
  }),
} as const;
