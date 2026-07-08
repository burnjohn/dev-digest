"use client";

/* BatchCompare — side-by-side metric comparison for two selected batches
   (AC-32), rendered inline under BatchHistoryTable. */

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalBatchCompareResult } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { pct, fmtDelta, fmtCostDelta, deltaColor } from "../helpers";
import { s } from "../styles";

interface BatchCompareProps {
  result: EvalBatchCompareResult;
  /** Adds a 4th "Cost" row sourced from `deltas.cost_usd` (AC-19, Agent Eval
   *  Dashboard compare modal). Off by default so the per-agent Evals tab's
   *  existing inline compare panel is unchanged. */
  showCost?: boolean;
}

interface CompareRow {
  label: string;
  a: string;
  b: string;
  delta: number;
  deltaText: string;
}

export function BatchCompare({ result, showCost }: BatchCompareProps) {
  const t = useTranslations("agents");

  const rows: CompareRow[] = [
    {
      label: t("evals.history.recall"),
      a: pct(result.a.recall),
      b: pct(result.b.recall),
      delta: result.deltas.recall,
      deltaText: fmtDelta(result.deltas.recall),
    },
    {
      label: t("evals.history.precision"),
      a: pct(result.a.precision),
      b: pct(result.b.precision),
      delta: result.deltas.precision,
      deltaText: fmtDelta(result.deltas.precision),
    },
    {
      label: t("evals.history.citationAccuracy"),
      a: pct(result.a.citation_accuracy),
      b: pct(result.b.citation_accuracy),
      delta: result.deltas.citation_accuracy,
      deltaText: fmtDelta(result.deltas.citation_accuracy),
    },
  ];

  if (showCost && result.deltas.cost_usd != null) {
    const costDelta = result.deltas.cost_usd;
    rows.push({
      label: t("evals.history.cost"),
      a: formatCost(result.a.cost_usd),
      b: formatCost(result.b.cost_usd),
      delta: costDelta,
      deltaText: fmtCostDelta(costDelta),
    });
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={s.sectionLabel}>{t("evals.compare.title")}</div>
      <table style={s.table} data-testid="batch-compare-panel">
        <thead>
          <tr>
            <th style={s.th}>{t("evals.compare.metric")}</th>
            <th style={s.th}>{t("evals.compare.batchA")}</th>
            <th style={s.th}>{t("evals.compare.batchB")}</th>
            <th style={s.th}>{t("evals.compare.delta")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={s.td}>{row.label}</td>
              <td style={s.td}>{row.a}</td>
              <td style={s.td}>{row.b}</td>
              <td style={{ ...s.td, color: deltaColor(row.delta), fontWeight: 600 }}>{row.deltaText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
