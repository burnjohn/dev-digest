"use client";

/* SkillKpiDeltaStrip — compact Δjudge-score / Δgrounding-pass-rate /
   Δcases-passing-rate display vs. the previous FULL batch. Placed near the
   Trend section. Renders a muted "no baseline yet" empty state when the
   server returns `null` (fewer than 2 full batches exist) — never fabricates
   a 0 delta. Mirrors the agent-eval KpiDeltaStrip structurally. Reverses
   this feature's original spec Non-goal (KPI-delta) at the user's explicit
   request. */

import { useTranslations } from "next-intl";
import type { SkillEvalKpiDeltaResponse } from "@devdigest/shared";
import { fmtDelta, deltaColor } from "../../helpers";
import { s } from "../../styles";

interface SkillKpiDeltaStripProps {
  delta: SkillEvalKpiDeltaResponse | undefined;
  isLoading: boolean;
}

export function SkillKpiDeltaStrip({ delta, isLoading }: SkillKpiDeltaStripProps) {
  const t = useTranslations("skills");

  if (isLoading) return null;

  if (!delta) {
    return (
      <div style={s.note} data-testid="skill-kpi-delta-empty">
        {t("evals.kpiDelta.noBaseline")}
      </div>
    );
  }

  const items: { label: string; value: number }[] = [
    { label: t("evals.history.judgeScore"), value: delta.judge_score },
    { label: t("evals.history.groundingPassRate"), value: delta.grounding_pass_rate },
    { label: t("evals.history.casesPassing"), value: delta.cases_passing_rate },
  ];

  return (
    <div
      data-testid="skill-kpi-delta-strip"
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
