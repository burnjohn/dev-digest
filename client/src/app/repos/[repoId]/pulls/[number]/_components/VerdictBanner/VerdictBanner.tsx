/* VerdictBanner — ported from findings.jsx.
   request_changes / approve / comment + summary + finding/blocker counts + score.
   Enhanced (PR Why + Risk Brief) with risk-level gauge, regenerate action,
   token/cost provenance line, and what/why narrative — all additive/optional. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, CircularScore } from "@devdigest/ui";
import { formatCost } from "@/lib/format";
import type { RiskLevel, Verdict } from "@devdigest/shared";
import { VERDICT_META, RISK_LEVEL_GAUGE } from "./constants";
import { s } from "./styles";

/** Compact token count formatter local to this component (e.g. 8200 -> "8.2K"). */
function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

export function VerdictBanner({
  verdict,
  summary,
  score,
  findingsCount,
  blockers,
  agentName,
  costUsd,
  what,
  why,
  riskLevel,
  tokensIn,
  tokensOut,
  onRegenerate,
  regenerating,
  generationError,
  onClear,
  clearing,
}: {
  verdict: Verdict;
  summary: string | null;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName?: string | null;
  costUsd?: number | null;
  what?: string | null;
  why?: string | null;
  riskLevel?: RiskLevel | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  onRegenerate?: () => void;
  regenerating?: boolean;
  generationError?: string | null;
  onClear?: () => void;
  clearing?: boolean;
}) {
  const t = useTranslations("prReview");
  const m = VERDICT_META[verdict] ?? VERDICT_META.comment;
  const VIcon = Icon[m.icon];

  // Narrative: prefer what/why concatenation when present, fall back to the
  // existing deterministic `summary` so PRs without a generated brief render
  // exactly as before.
  const narrative = what || why ? [what, why].filter(Boolean).join(" ") : summary;

  // Gauge value: risk_level (string) is the real source of truth; the numeric
  // value below is a display-only proxy solely to drive CircularScore's
  // existing green/amber/red thresholds (>=75 ok / >=50 warn / else crit).
  const gaugeScore = riskLevel != null ? RISK_LEVEL_GAUGE[riskLevel] : score;

  const showScoreCol = gaugeScore != null || onRegenerate || onClear;

  const provenance =
    costUsd != null
      ? tokensIn != null && tokensOut != null
        ? `${formatCost(costUsd)} ${formatTokens(tokensIn)}+${formatTokens(tokensOut)}`
        : formatCost(costUsd)
      : null;

  return (
    <div style={s.wrap}>
      <div style={s.iconBox(m.bg, m.c)}>
        <VIcon size={22} />
      </div>
      <div style={s.main}>
        <div style={s.titleRow}>
          <span style={s.label(m.c)}>{t(`verdict.${m.labelKey}`)}</span>
          <Badge color="var(--text-secondary)">
            {t("verdict.findingsCount", { count: findingsCount })}
            {blockers > 0 ? t("verdict.blockers", { count: blockers }) : ""}
          </Badge>
          {agentName && (
            <Badge color="var(--accent-text)" bg="var(--accent-bg)" icon="Cpu">
              {agentName}
            </Badge>
          )}
        </div>
        {narrative && <p style={s.summary}>{narrative}</p>}
        {generationError && (
          <p style={s.inlineError}>
            {t("verdict.generationError", { error: generationError })}
          </p>
        )}
      </div>
      {showScoreCol && (
        <div style={s.scoreCol}>
          <div style={s.scoreHeader}>
            {gaugeScore != null && <CircularScore score={gaugeScore} size={52} stroke={5} />}
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={regenerating}
                aria-label={
                  regenerating ? t("verdict.regenerating") : t("verdict.regenerate")
                }
                title={regenerating ? t("verdict.regenerating") : t("verdict.regenerate")}
                style={{
                  ...s.regenerateBtn,
                  ...(regenerating ? s.regenerateBtnDisabled : {}),
                }}
              >
                <Icon.RefreshCw
                  size={14}
                  style={regenerating ? { animation: "ddspin 1s linear infinite" } : undefined}
                />
              </button>
            )}
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                disabled={clearing}
                aria-label={clearing ? t("verdict.clearing") : t("verdict.clearBrief")}
                title={clearing ? t("verdict.clearing") : t("verdict.clearBrief")}
                style={{
                  ...s.clearBtn,
                  ...(clearing ? s.clearBtnDisabled : {}),
                }}
              >
                <Icon.Trash size={14} />
              </button>
            )}
          </div>
          {gaugeScore != null && <span style={s.scoreLabel}>{t("verdict.prScore")}</span>}
          {provenance != null && <span style={s.provenanceLine}>{provenance}</span>}
        </div>
      )}
    </div>
  );
}
