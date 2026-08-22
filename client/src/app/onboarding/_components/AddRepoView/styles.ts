import type { CSSProperties } from "react";

export const s = {
  page: {
    width: "100%",
    minHeight: "100vh",
    background: "var(--bg-primary)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "44px 28px",
  } satisfies CSSProperties,

  brand: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 32,
  } satisfies CSSProperties,

  brandIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: "var(--text-primary)",
    display: "grid",
    placeItems: "center",
  } satisfies CSSProperties,

  card: {
    position: "relative",
    width: 520,
    maxWidth: "100%",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: 36,
    boxShadow: "var(--shadow-modal)",
  } satisfies CSSProperties,

  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
  } satisfies CSSProperties,

  error: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    background: "var(--crit-bg)",
    border: "1px solid rgba(239,68,68,0.25)",
    marginTop: 16,
  } satisfies CSSProperties,

  actions: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    marginTop: 24,
  } satisfies CSSProperties,

  footer: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginTop: 24,
    display: "inline-flex",
    gap: 8,
    alignItems: "center",
  } satisfies CSSProperties,
};
