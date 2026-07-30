import React from "react";

const style: React.CSSProperties = {
  fontSize: 12,
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-secondary)",
};

export function RunCostBadge({ cost }: { cost: number | null | undefined }) {
  if (cost == null) return null;
  return <span style={style}>${cost.toFixed(3)}</span>;
}
