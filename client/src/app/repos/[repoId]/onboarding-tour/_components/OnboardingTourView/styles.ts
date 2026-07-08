import type { CSSProperties } from "react";

export const s = {
  page: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
    padding: "20px 24px",
  } satisfies CSSProperties,

  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap" as const,
  } satisfies CSSProperties,

  title: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  } satisfies CSSProperties,

  accent: {
    color: "var(--accent-text)",
  } satisfies CSSProperties,

  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "4px 0 0",
  } satisfies CSSProperties,

  actions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  inProgress: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  errorBanner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
    fontSize: 13,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  layout: {
    display: "grid",
    gridTemplateColumns: "200px 1fr",
    gap: 20,
    alignItems: "start",
  } satisfies CSSProperties,

  toc: {
    position: "sticky" as const,
    top: 20,
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } satisfies CSSProperties,

  tocLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    marginBottom: 4,
  } satisfies CSSProperties,

  tocLink: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    textDecoration: "none",
    padding: "3px 0",
  } satisfies CSSProperties,

  sections: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
    minWidth: 0,
  } satisfies CSSProperties,

  skeletonWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  } satisfies CSSProperties,

  skeletonCard: {
    height: 90,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    opacity: 0.5,
  } satisfies CSSProperties,
} as const;
