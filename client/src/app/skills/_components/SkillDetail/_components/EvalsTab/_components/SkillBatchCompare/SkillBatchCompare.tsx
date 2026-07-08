"use client";

/* SkillBatchCompare — side-by-side metric comparison for two selected
   full-kind skill-eval batches, rendered inline under SkillEvalBatchHistory.
   Mirrors the agent-eval BatchCompare structurally (adapted vocabulary: judge
   score / grounding pass rate / cases passing rate, NOT recall/precision/
   citation-accuracy). Reverses this feature's original spec Non-goal
   (BatchCompare) at the user's explicit request. */

import React from "react";
import { useTranslations } from "next-intl";
import type { SkillEvalBatchCompareResult } from "@devdigest/shared";
import { pct, fmtDelta, deltaColor } from "../../helpers";
import { s } from "../../styles";

export function SkillBatchCompare({ result }: { result: SkillEvalBatchCompareResult }) {
  const t = useTranslations("skills");

  const rows: { label: string; a: number | null; b: number | null; delta: number }[] = [
    {
      label: t("evals.history.judgeScore"),
      a: result.a.judge_score,
      b: result.b.judge_score,
      delta: result.deltas.judge_score,
    },
    {
      label: t("evals.history.groundingPassRate"),
      a: result.a.grounding_pass_rate,
      b: result.b.grounding_pass_rate,
      delta: result.deltas.grounding_pass_rate,
    },
    {
      label: t("evals.history.casesPassing"),
      a:
        result.a.cases_passing != null && result.a.cases_total
          ? result.a.cases_passing / result.a.cases_total
          : null,
      b:
        result.b.cases_passing != null && result.b.cases_total
          ? result.b.cases_passing / result.b.cases_total
          : null,
      delta: result.deltas.cases_passing_rate,
    },
  ];

  return (
    <div style={{ marginTop: 14 }}>
      <div style={s.sectionLabel}>{t("evals.compare.title")}</div>
      <table style={s.table} data-testid="skill-batch-compare-panel">
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
              <td style={s.td}>{pct(row.a)}</td>
              <td style={s.td}>{pct(row.b)}</td>
              <td style={{ ...s.td, color: deltaColor(row.delta), fontWeight: 600 }}>{fmtDelta(row.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
