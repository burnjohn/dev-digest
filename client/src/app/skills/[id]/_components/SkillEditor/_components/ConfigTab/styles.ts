import type { CSSProperties } from "react";

export const s = {
  wrap: { padding: "24px 28px 44px", maxWidth: 860 } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 22,
  } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  enabledBox: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  enabledLabel: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  error: {
    fontSize: 12,
    color: "var(--crit)",
    background: "var(--crit-bg)",
    padding: "8px 10px",
    borderRadius: 6,
    marginBottom: 16,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  modalBody: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 } satisfies CSSProperties,
  modalWarn: {
    fontSize: 13,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "8px 10px",
    borderRadius: 6,
    marginTop: 12,
    lineHeight: 1.45,
  } satisfies CSSProperties,
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
