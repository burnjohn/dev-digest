"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalSkillRunRecord } from "@devdigest/shared/contracts/eval-ci";
import { formatMetricDeltaPct, formatMetricPct } from "@/lib/eval-format";
import { isAllZeroLift } from "./helpers";
import { s } from "./styles";

/**
 * AC-34 — the latest run's three metrics WITH their lift, a helped/hurt/
 * unaffected count, and the skill's per-run token cost. `run` is null when
 * this skill's cases have never been run (AC-38) — every tile then reads
 * "n/a" and no lift/count/gate notice renders at all.
 *
 * AC-41: an all-zero lift renders as a stated sentence, never a bare "0" on
 * every tile. AC-47: every lift carries a sign/word AND a colour, never
 * colour alone. AC-52: a gates-bypassed run states so here too.
 */
export function SkillMetricTiles({
  run,
  tokensPerRun,
}: {
  run: EvalSkillRunRecord | null;
  tokensPerRun: number | null;
}) {
  const t = useTranslations("eval");
  const na = t("notApplicable");
  const metrics = run?.metrics ?? null;
  const lift = run?.lift ?? null;
  const allZeroLift = isAllZeroLift(lift);

  return (
    <div style={s.section}>
      <div style={s.tiles} role="group" aria-label={t("evalsTab.metricsTitle")}>
        <Tile
          label={t("dashboard.metrics.recall")}
          value={formatMetricPct(metrics?.recall, na)}
          delta={!allZeroLift && lift ? formatMetricDeltaPct(lift.recall, na) : null}
        />
        <Tile
          label={t("dashboard.metrics.precision")}
          value={formatMetricPct(metrics?.precision, na)}
          delta={!allZeroLift && lift ? formatMetricDeltaPct(lift.precision, na) : null}
        />
        <Tile
          label={t("dashboard.metrics.citationAccuracy")}
          value={formatMetricPct(metrics?.citation_accuracy, na)}
          delta={!allZeroLift && lift ? formatMetricDeltaPct(lift.citation_accuracy, na) : null}
        />
        <Tile
          label={t("evalsTab.casesPassed")}
          value={metrics ? `${metrics.traces_passed}/${metrics.traces_total}` : na}
          delta={null}
        />
      </div>

      {/* AC-41 — the all-zero case is a STATED sentence, never a bare 0 on
          every tile (the tiles above suppress their per-metric delta when
          this is true, so the sentence is the only signal). */}
      {allZeroLift && <p style={s.hint}>{t("skill.lift.allZero")}</p>}

      {run && (
        <div style={s.effectRow} role="group" aria-label={t("skill.effect.title")}>
          <span style={s.effectCount}>
            <Icon.TrendingUp size={13} style={{ color: "var(--ok, var(--text-secondary))" }} />
            {t("skill.effect.helpedCount", { count: run.effect_counts.helped })}
          </span>
          <span style={s.effectCount}>
            <Icon.TrendingDown size={13} style={{ color: "var(--crit)" }} />
            {t("skill.effect.hurtCount", { count: run.effect_counts.hurt })}
          </span>
          <span style={s.effectCount}>
            <Icon.Slash size={13} style={{ color: "var(--text-muted)" }} />
            {t("skill.effect.unaffectedCount", {
              count: run.effect_counts.no_effect_pass + run.effect_counts.no_effect_fail,
            })}
          </span>
        </div>
      )}

      {tokensPerRun != null && <p style={s.hint}>{t("skill.tokensPerRun", { count: tokensPerRun })}</p>}

      {run?.gates_bypassed && (
        <p style={s.notice}>
          <Icon.AlertTriangle size={13} />
          {t("skill.gatesBypassedNotice")}
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, delta }: { label: string; value: string; delta: string | null }) {
  const up = delta?.startsWith("+");
  const down = delta?.startsWith("-");
  const color = up ? "var(--ok, var(--text-secondary))" : down ? "var(--crit)" : "var(--text-muted)";
  return (
    <div style={s.tile}>
      <div style={s.tileLabel}>{label}</div>
      <div style={s.tileValue}>{value}</div>
      {delta && <div style={s.tileDelta(color)}>{delta}</div>}
    </div>
  );
}
