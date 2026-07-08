"use client";

/* SkillEvalMetrics — top-of-tab KPI strip for the skill Evals tab. Adapted
   vocabulary from the agent-eval EvalMetrics (which shows recall/precision/
   citation-accuracy): judge score, grounding pass rate, cases passing, cost —
   sourced from the newest batch in the skill's batch history (AC-31). */

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SkillEvalBatch } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { s } from "../../styles";
import { pct } from "../../helpers";

interface SkillEvalMetricsProps {
  /** Newest batch (server-sorted `ORDER BY ran_at DESC`), or null if no batch
      has run yet. */
  latestBatch: SkillEvalBatch | null;
}

export function SkillEvalMetrics({ latestBatch }: SkillEvalMetricsProps) {
  const t = useTranslations("skills");

  const casesPassing =
    latestBatch?.cases_passing != null && latestBatch?.cases_total != null
      ? `${latestBatch.cases_passing}/${latestBatch.cases_total}`
      : "—";

  // Distinct semantic color per KPI (mirrors the agent-eval EvalMetrics
  // convention) so the strip reads at-a-glance instead of a uniformly muted
  // block; cost stays neutral (--text-secondary) since it isn't a quality
  // signal.
  const cards = [
    {
      key: "judgeScore",
      label: t("evals.metrics.judgeScore"),
      value: pct(latestBatch?.judge_score ?? null),
      color: "var(--accent)",
    },
    {
      key: "groundingPassRate",
      label: t("evals.metrics.groundingPassRate"),
      value: pct(latestBatch?.grounding_pass_rate ?? null),
      color: "var(--ok)",
    },
    { key: "casesPassing", label: t("evals.metrics.casesPassing"), value: casesPassing, color: "var(--warn)" },
    {
      key: "cost",
      label: t("evals.metrics.cost"),
      value: formatCost(latestBatch?.cost_usd ?? null),
      color: "var(--text-secondary)",
    },
  ];

  return (
    <div>
      <div style={s.metricsHeader}>
        <span style={s.metricsTitle}>
          <Icon.FlaskConical size={13} />
          {t("evals.metrics.title")}
        </span>
      </div>
      <div style={s.metricsGrid}>
        {cards.map((c) => (
          <div key={c.key} style={s.metricCard}>
            <div style={s.metricLabel}>{c.label}</div>
            <span style={{ ...s.metricValue, color: c.color }}>{c.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
