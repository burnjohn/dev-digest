import type { CSSProperties } from "react";

/** Co-located styles for RecentRunsFeed (local additions only — table cell
 *  tokens are reused directly from `@/components/eval`'s shared styles.ts,
 *  not duplicated). */
export const s = {
  title: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 10,
  } satisfies CSSProperties,
  versionToken: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
  } satisfies CSSProperties,
  // A metric cell: a small colored progress bar + its percentage, side by side.
  metricCell: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,
  barTrack: {
    width: 88,
    height: 8,
    borderRadius: 4,
    background: "var(--bg-hover)",
    overflow: "hidden",
    flexShrink: 0,
  } satisfies CSSProperties,
  barFill: {
    height: "100%",
    borderRadius: 4,
  } satisfies CSSProperties,
  barPct: {
    fontSize: 12,
    color: "var(--text-secondary)",
    minWidth: 34,
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
} as const;
