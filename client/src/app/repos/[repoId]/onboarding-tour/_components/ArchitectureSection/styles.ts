import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
  } satisfies CSSProperties,

  diagramWrap: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,

  diagramLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,

  diagramPre: {
    margin: 0,
    padding: 12,
    fontSize: 12,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap" as const,
    overflowX: "auto" as const,
  } satisfies CSSProperties,

  diagramSvg: {
    padding: 24,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: 80,
    overflowX: "auto" as const,
  } satisfies CSSProperties,
} as const;
