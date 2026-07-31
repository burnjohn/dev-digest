import type { CSSProperties } from "react";

export const s = {
  severityFilterBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "4px 0 12px",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  severityFilterBtn: {
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    transition: "opacity 0.12s",
  } satisfies CSSProperties,
  severityClearBtn: {
    background: "none",
    border: "none",
    padding: "2px 6px",
    cursor: "pointer",
    fontSize: 12,
    color: "var(--text-muted)",
    textDecoration: "underline",
  } satisfies CSSProperties,
  reviewInProgress: {
    marginBottom: 18,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  reviewInProgressText: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  reviewInProgressSub: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  lethalTrifecta: {
    marginBottom: 18,
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
  } satisfies CSSProperties,
  lethalTrifectaTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--crit)",
  } satisfies CSSProperties,
  liveRunSection: {
    marginBottom: 18,
  } satisfies CSSProperties,
  timelineSection: {
    marginBottom: 18,
  } satisfies CSSProperties,
  cancelActions: {
    display: "flex",
    gap: 8,
  } satisfies CSSProperties,
} as const;
