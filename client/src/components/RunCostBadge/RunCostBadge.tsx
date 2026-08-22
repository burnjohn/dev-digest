import type { CSSProperties } from "react";

const s = {
  compact: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,
  muted: {
    color: "var(--text-muted)",
  } satisfies CSSProperties,
};

/**
 * Displays an LLM run cost in one of two layouts:
 *
 *   compact — "$0.014"   (for PR list column)
 *
 * Rules: null / zero cost renders "–" (no data), not "$0.00".
 */
export function RunCostBadge({
  cost,
  variant = "compact",
}: {
  cost: number | null | undefined;
  variant?: "compact";
}) {
  if (cost == null || cost === 0) {
    return <span style={s.muted}>–</span>;
  }
  return (
    <span style={s.compact} className="tnum">
      ${cost.toFixed(3)}
    </span>
  );
}
