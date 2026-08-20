/* Shared read-out for what a single agent run cost. Two variants because the
   same number appears at two densities: bare in the PR list's COST column, and
   alongside the token count in the PR-detail timeline. Keeping both here stops
   the "$0.00 vs —" rule from being re-decided per call site. */
"use client";

import { useTranslations } from "next-intl";
import { formatCostUsd, formatTokenCount } from "../../lib/format";

interface RunCostBadgeProps {
  /** USD for the run. Null when unpriced or the run never reached the model. */
  cost: number | null | undefined;
  /**
   * `compact` → "$0.014" (or "—"). `withTokens` → "9 119 tok · $0.0013".
   */
  variant?: "compact" | "withTokens";
  /** Total tokens (in + out). Required by `withTokens`, ignored by `compact`. */
  tokens?: number | null;
}

export function RunCostBadge({ cost, variant = "compact", tokens }: RunCostBadgeProps) {
  const t = useTranslations("runs");

  if (variant === "compact") {
    return (
      <span className="tnum" style={{ color: cost == null ? "var(--text-muted)" : undefined }}>
        {formatCostUsd(cost)}
      </span>
    );
  }

  // A run can have tokens but no price (model missing from the price book). Show
  // what we know and drop the cost segment entirely — a trailing "· —" on every
  // such row is noise, and the token count already proves the run did work.
  const hasTokens = tokens != null && tokens > 0;
  const hasCost = cost != null;
  if (!hasTokens && !hasCost) return null;

  return (
    <span className="tnum">
      {hasTokens && t("cost.tokens", { tokens: formatTokenCount(tokens) })}
      {hasTokens && hasCost && " · "}
      {hasCost && formatCostUsd(cost)}
    </span>
  );
}

export default RunCostBadge;
