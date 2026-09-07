"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Icon } from "@devdigest/ui";
import type { EvalSkillSummary } from "@devdigest/shared/contracts/eval-ci";
import { formatMetricDeltaPct } from "@/lib/eval-format";
import { s } from "./styles";

/**
 * AC-39, AC-40, AC-41, AC-52 — one row per skill owning ≥1 case: its
 * latest run's LIFT (not raw metrics — a skill's own section states lift,
 * distinct from the agent table above it), its helped/hurt counts and its
 * carrier. There is no per-skill detail page (SPEC-15 resolved decision 3),
 * so the row opens the skill editor's own Evals tab instead of a dashboard
 * detail route.
 */
export function SkillSummaryRow({ skill }: { skill: EvalSkillSummary }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const na = t("notApplicable");
  const lift = skill.latest?.lift ?? null;
  const allZeroLift = !!lift && lift.recall === 0 && lift.precision === 0 && lift.citation_accuracy === 0;
  const open = () => router.push(`/skills/${skill.skill_id}?tab=evals`);

  return (
    <div style={s.agentRow}>
      <div style={s.agentMain}>
        <button
          type="button"
          style={s.agentName}
          onClick={open}
          aria-label={t("dashboard.openAgent", { agent: skill.skill_name })}
        >
          {skill.skill_name}
        </button>
        <span style={s.agentMeta}>
          {t("skill.summary.carrier", {
            carrier: skill.carrier_agent_name ?? t("skill.summary.noCarrier"),
          })}
        </span>
      </div>
      <div style={s.agentMetrics}>
        <div style={s.metricCol}>
          <span style={s.metricLabel}>{t("dashboard.metrics.recall")}</span>
          <span style={s.metricVal}>{!allZeroLift && lift ? formatMetricDeltaPct(lift.recall, na) : na}</span>
        </div>
        <div style={s.metricCol}>
          <span style={s.metricLabel}>{t("dashboard.metrics.precision")}</span>
          <span style={s.metricVal}>{!allZeroLift && lift ? formatMetricDeltaPct(lift.precision, na) : na}</span>
        </div>
        <div style={s.metricCol}>
          <span style={s.metricLabel}>{t("dashboard.metrics.citationAccuracy")}</span>
          <span style={s.metricVal}>
            {!allZeroLift && lift ? formatMetricDeltaPct(lift.citation_accuracy, na) : na}
          </span>
        </div>
        <div style={s.metricCol}>
          <span style={s.metricLabel}>{t("skill.effect.title")}</span>
          <span style={s.metricVal}>
            {skill.latest
              ? t("skill.summary.helpedHurt", {
                  helped: skill.latest.effect_counts.helped,
                  hurt: skill.latest.effect_counts.hurt,
                })
              : na}
          </span>
        </div>
      </div>
      {allZeroLift && <p style={s.note}>{t("skill.lift.allZero")}</p>}
      {skill.latest?.gates_bypassed && (
        <span style={s.outcome("var(--warn)")}>
          <Icon.AlertTriangle size={12} />
          {t("skill.gatesBypassedNotice")}
        </span>
      )}
    </div>
  );
}
