/* RunCostBadge — shows a run's USD cost (and, in detailed form, its tokens).
   compact:  "$0.012"                (PR list COST column)
   detailed: "$0.014 · 8.2K→1.3K"    (PR-detail run timeline)
   No cost data (unknown model / missing tokens) ⇒ "—", never "$0.00". */
import React from "react";
import { Badge } from "@devdigest/ui";
import { formatCost, formatTokens } from "../../[number]/_components/RunTraceDrawer/helpers";

export function RunCostBadge({
  cost,
  tokensIn,
  tokensOut,
  variant = "compact",
}: {
  cost: number | null | undefined;
  tokensIn?: number | null;
  tokensOut?: number | null;
  variant?: "compact" | "detailed";
}) {
  const showTokens =
    variant === "detailed" && cost != null && tokensIn != null && tokensOut != null;
  return (
    <Badge mono color="var(--text-secondary)" bg="transparent">
      {formatCost(cost)}
      {showTokens ? ` · ${formatTokens(tokensIn!, tokensOut!)}` : ""}
    </Badge>
  );
}
