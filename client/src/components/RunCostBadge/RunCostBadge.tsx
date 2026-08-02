/* RunCostBadge — the USD a review run cost, rendered the two ways the design
   asks for: bare in the PR-list COST column, and with its token count in the
   run timeline / verdict banner. */
"use client";

import React from "react";
import { formatCost, formatTokens } from "../../lib/cost";

type Props =
  | { variant: "compact"; cost: number | null | undefined }
  | {
      variant: "withTokens";
      cost: number | null | undefined;
      tokensIn: number | null | undefined;
      tokensOut: number | null | undefined;
    };

export function RunCostBadge(props: Props) {
  const known = props.cost != null && Number.isFinite(props.cost);

  if (props.variant === "compact") {
    return (
      <span className="tnum" style={{ color: known ? undefined : "var(--text-muted)" }}>
        {formatCost(props.cost)}
      </span>
    );
  }

  const total = (props.tokensIn ?? 0) + (props.tokensOut ?? 0);
  // Nothing measured at all — a run that failed before its first call. One dash
  // beats "0 tok · —".
  if (total === 0 && !known) return <span style={{ color: "var(--text-muted)" }}>—</span>;

  return (
    <span className="tnum" style={{ color: "var(--text-muted)" }}>
      {formatTokens(props.tokensIn, props.tokensOut)} tok · {formatCost(props.cost)}
    </span>
  );
}
