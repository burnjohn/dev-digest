"use client";

/* KpiDeltaStrip — compact Δrecall / Δprecision / Δcitation display vs. the
   previous FULL batch (AC-31). Placed near the Trend section in EvalsTab.
   Renders a muted "no baseline yet" empty state when the server returns
   `null` (fewer than 2 full batches exist) — never fabricates a 0 delta. */

import { useTranslations } from "next-intl";
import type { EvalKpiDeltaResponse } from "@devdigest/shared";
import { fmtDelta, deltaColor, evalStyles as s } from "@/components/eval";

interface KpiDeltaStripProps {
  delta: EvalKpiDeltaResponse | undefined;
  isLoading: boolean;
}

export function KpiDeltaStrip({ delta, isLoading }: KpiDeltaStripProps) {
  const t = useTranslations("agents");

  if (isLoading) return null;

  if (!delta) {
    return (
      <div style={s.note} data-testid="kpi-delta-empty">
        {t("evals.kpiDelta.noBaseline")}
      </div>
    );
  }

  const items: { label: string; value: number }[] = [
    { label: t("evals.history.recall"), value: delta.recall },
    { label: t("evals.history.precision"), value: delta.precision },
    { label: t("evals.history.citationAccuracy"), value: delta.citation_accuracy },
  ];

  return (
    <div
      data-testid="kpi-delta-strip"
      style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}
    >
      <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {t("evals.kpiDelta.label")}
      </span>
      {items.map((item) => (
        <span key={item.label} style={{ fontSize: 12.5, display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ color: "var(--text-secondary)" }}>{item.label}</span>
          <span style={{ color: deltaColor(item.value), fontWeight: 700 }}>{fmtDelta(item.value)}</span>
        </span>
      ))}
    </div>
  );
}
