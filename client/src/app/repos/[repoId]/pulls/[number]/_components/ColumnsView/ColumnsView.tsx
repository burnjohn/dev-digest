/* ColumnsView — SPEC-07 T11 (G5). One card per run of the current
   multi-agent group: CircularScore, agent name, RunCostBadge, a status badge
   (`outcomeOf`, promoted to `@/lib/run-outcome` so RunHistory and this view
   share one derivation, AC-26), this run's findings (title + `file:line` +
   severity icon via `SEV`), and a "View trace" action. Re-renders on
   `usePrRuns`'s existing 4s poll while any run in the group is `running`
   (AC-27) — the caller (`MultiAgentReviewTab`) already reuses that hook's
   data as-is; this component starts no poll of its own. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, CircularScore, Icon, SEV } from "@devdigest/ui";
import { RunCostBadge } from "@/components/run-cost-badge";
import { FindingsTooltip, SEVERITY_DISPLAY_ORDER } from "@/components/findings-tooltip";
import { severityCounts } from "@/lib/findings";
import { deriveLiveColumns } from "./helpers";
import { s } from "./styles";
import type { ReviewRecord, RunSummary } from "@devdigest/shared";

interface ColumnsViewProps {
  /** The current group's runs (`MultiAgentReviewTab`'s `activeGroup.runs`). */
  runs: RunSummary[];
  /** Persisted reviews for this PR — matched by `run_id`, same pattern as
   *  `RunHistory`'s own `findingsByRunId` map, no extra fetch. */
  reviews: ReviewRecord[];
  onOpenTrace: (runId: string) => void;
}

export function ColumnsView({ runs, reviews, onOpenTrace }: ColumnsViewProps) {
  const t = useTranslations("prReview");

  const columns = React.useMemo(() => deriveLiveColumns(runs, reviews), [runs, reviews]);

  return (
    <div style={s.grid}>
      {columns.map(({ run, outcome: o, settled, findings }) => {
        return (
          <div key={run.run_id} style={s.column}>
            <div style={s.columnHeader}>
              {settled && run.score != null && <CircularScore score={run.score} size={32} stroke={3} />}
              <div style={s.columnHeaderMeta}>
                <span style={s.agentName}>{run.agent_name ?? t("multiAgentReview.unknownAgent")}</span>
                <span className="mono" style={s.model}>
                  {run.provider}/{run.model}
                </span>
              </div>
            </div>

            <Badge color={o.color} bg={o.bg} icon={o.icon}>
              {t(`runStatus.${o.key}`)}
            </Badge>

            {run.status === "failed" && run.error && (
              <div style={s.errorText} title={run.error}>
                {run.error}
              </div>
            )}

            {settled && (
              <RunCostBadge
                costUsd={run.cost_usd}
                tokensIn={run.tokens_in}
                tokensOut={run.tokens_out}
                variant="detailed"
                tokenFormat="total"
              />
            )}

            {settled && (
              <div style={s.findingsList}>
                {findings.length === 0 ? (
                  <span style={s.noFindings}>{t("multiAgentReview.noFindings")}</span>
                ) : (
                  // Coordinator fix (per user feedback on a screenshot): a card
                  // per finding (title + file:line) made the column tall and
                  // cluttered with several findings, and the file:line text
                  // had its own overflow bug (see the immediately-preceding
                  // fix commit). Replaced with the same compact per-severity
                  // count badges `RunHistory` already uses (`severityCounts`,
                  // `SEVERITY_DISPLAY_ORDER`, `FindingsTooltip`) — same data,
                  // nothing lost: hovering a badge still shows the individual
                  // findings via the shared tooltip, same as the "Agent runs"
                  // tab already does.
                  (() => {
                    const counts = severityCounts(findings);
                    return (
                      <div style={s.severityBadges}>
                        {SEVERITY_DISPLAY_ORDER.filter((sev) => (counts[sev] ?? 0) > 0).map((sev) => {
                          const SevIcon = Icon[SEV[sev].icon];
                          const sevFindings = findings.filter((f) => f.severity === sev);
                          return (
                            <FindingsTooltip key={sev} findings={sevFindings}>
                              <span data-testid={`severity-badge-${sev}`} style={{ ...s.severityBadge, color: SEV[sev].c }}>
                                <SevIcon size={12} />
                                {counts[sev]}
                              </span>
                            </FindingsTooltip>
                          );
                        })}
                      </div>
                    );
                  })()
                )}
              </div>
            )}

            <Button kind="ghost" size="sm" icon="FileText" onClick={() => onOpenTrace(run.run_id)}>
              {t("multiAgentReview.viewTrace")}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
