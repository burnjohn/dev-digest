"use client";

/* SkillEvalBatchHistory — batch runs (timestamp, host agent, model, the
   three skill-eval metrics, cost, status pill). Clicking a row expands an
   inline per-case drill-down (via useSkillEvalBatchDetail — the SAME hook
   used for the run-completion poll elsewhere, just a different batch id).
   Selecting exactly two full-kind batches renders SkillBatchCompare inline
   underneath. Calibration batches are NOT selectable (a disabled placeholder
   with a tooltip is shown instead) — a calibration batch's subset of cases
   and a full batch's complete set are disjoint, so a signed delta between
   them is not comparable. Mirrors the agent-eval BatchHistoryTable
   structurally. Reverses this feature's original spec Non-goals
   (checkbox-select / drill-down / compare) at the user's explicit request. */

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox } from "@devdigest/ui";
import type { SkillEvalBatch, Agent } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { useSkillEvalBatchDetail, useSkillEvalCompare } from "@/lib/hooks/skills";
import { SkillBatchCompare } from "../SkillBatchCompare/SkillBatchCompare";
import { pct } from "../../helpers";
import { s } from "../../styles";

interface SkillEvalBatchHistoryProps {
  skillId: string;
  batches: SkillEvalBatch[];
  agents: Agent[];
  /** Batch id to highlight + scroll into view — driven by SkillTrendChart
   *  hover so the chart links to THIS table instead of duplicating its
   *  details. */
  highlightBatchId?: string | null;
}

export function SkillEvalBatchHistory({ skillId, batches, agents, highlightBatchId }: SkillEvalBatchHistoryProps) {
  const t = useTranslations("skills");
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const rowRefs = React.useRef<Map<string, HTMLTableRowElement>>(new Map());

  // Scroll the chart-hovered batch into view. `?.()` on the method — jsdom
  // (tests) doesn't implement scrollIntoView, so it no-ops there.
  React.useEffect(() => {
    if (highlightBatchId) rowRefs.current.get(highlightBatchId)?.scrollIntoView?.({ block: "nearest" });
  }, [highlightBatchId]);

  const detail = useSkillEvalBatchDetail(skillId, expandedId);

  // Compare is only meaningful between two "full" batches (same case set,
  // run to completion); a calibration batch's subset of cases and a full
  // batch's complete set are disjoint, so a signed delta between them is not
  // comparable. Restrict selection to full-kind batches only.
  const toggleSelected = (id: string) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch || batch.kind !== "full") return;
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1]!, id];
      return [...prev, id];
    });
  };

  const [batchIdA, batchIdB] = selected;
  const compare = useSkillEvalCompare(skillId, batchIdA, batchIdB);

  if (batches.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("evals.history.empty")}</div>;
  }

  return (
    <div>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}></th>
            <th style={s.th}>{t("evals.history.timestamp")}</th>
            <th style={s.th}>{t("evals.history.hostAgent")}</th>
            <th style={s.th}>{t("evals.history.model")}</th>
            <th style={s.th}>{t("evals.history.judgeScore")}</th>
            <th style={s.th}>{t("evals.history.groundingPassRate")}</th>
            <th style={s.th}>{t("evals.history.casesPassing")}</th>
            <th style={s.th}>{t("evals.history.cost")}</th>
            <th style={s.th}>{t("evals.history.status")}</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => {
            const isCalibration = batch.kind === "calibration";
            const isUnsealed = !isCalibration && batch.status == null;
            const statusLabel = isCalibration
              ? t("evals.history.statusCalibration")
              : isUnsealed
                ? t("evals.history.statusRunning")
                : batch.status === "degraded"
                  ? t("evals.history.statusDegraded")
                  : t("evals.history.statusClean");
            const statusColor = isCalibration
              ? "var(--info)"
              : isUnsealed
                ? "var(--text-muted)"
                : batch.status === "degraded"
                  ? "var(--crit)"
                  : "var(--ok)";
            const casesPassing =
              batch.cases_passing != null ? `${batch.cases_passing}/${batch.cases_total}` : "—";
            const isExpanded = expandedId === batch.id;
            // Only full-kind batches are selectable for compare.
            const selectable = batch.kind === "full";

            return (
              <React.Fragment key={batch.id}>
                <tr
                  ref={(el) => {
                    if (el) rowRefs.current.set(batch.id, el);
                    else rowRefs.current.delete(batch.id);
                  }}
                  style={{ ...s.batchRow, background: batch.id === highlightBatchId ? "var(--bg-hover)" : undefined }}
                  onClick={() => setExpandedId(isExpanded ? null : batch.id)}
                >
                  <td style={s.td} onClick={(e) => e.stopPropagation()}>
                    {selectable ? (
                      <Checkbox checked={selected.includes(batch.id)} onChange={() => toggleSelected(batch.id)} />
                    ) : (
                      <span title={t("evals.history.compareFullOnly")} style={{ display: "inline-block", width: 16 }} />
                    )}
                  </td>
                  <td style={s.td}>{new Date(batch.ran_at).toLocaleString()}</td>
                  <td style={s.td}>{agentNameById.get(batch.host_agent_id) ?? batch.host_agent_id}</td>
                  <td style={s.td}>{batch.model}</td>
                  <td style={s.td}>{pct(batch.judge_score)}</td>
                  <td style={s.td}>{pct(batch.grounding_pass_rate)}</td>
                  <td style={s.td}>{casesPassing}</td>
                  <td style={s.td}>{formatCost(batch.cost_usd)}</td>
                  <td style={s.td}>
                    <Badge color={statusColor}>{statusLabel}</Badge>
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td style={s.td} colSpan={9}>
                      <div style={s.drilldownWrap}>
                        {detail.isLoading && <span style={{ fontSize: 12 }}>…</span>}
                        {detail.data && (
                          <table style={s.table}>
                            <thead>
                              <tr>
                                <th style={s.th}>{t("evals.history.drilldown.case")}</th>
                                <th style={s.th}>{t("evals.history.drilldown.outcome")}</th>
                                <th style={s.th}>{t("evals.history.drilldown.groundingMissing")}</th>
                                <th style={s.th}>{t("evals.history.drilldown.judgeScore")}</th>
                                <th style={s.th}>{t("evals.history.drilldown.cost")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.data.cases.map((c) => (
                                <tr key={c.case_id}>
                                  <td style={s.td}>
                                    {c.case_name}
                                    {c.status === "error" && c.error_message && (
                                      <div style={s.caseErrorMessage} title={c.error_message}>
                                        {t("evals.history.drilldown.errorLabel")} {c.error_message}
                                      </div>
                                    )}
                                  </td>
                                  <td style={s.td}>{t(`evals.status.${c.status}`)}</td>
                                  <td style={s.td}>
                                    {c.grounding_missing.length > 0 ? c.grounding_missing.join(", ") : "—"}
                                  </td>
                                  <td style={s.td}>{pct(c.judge_score)}</td>
                                  <td style={s.td}>{formatCost(c.cost_usd)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {selected.length === 1 && <div style={{ ...s.note, marginTop: 10 }}>{t("evals.history.selectTwoHint")}</div>}
      {selected.length === 2 && compare.data && <SkillBatchCompare result={compare.data} />}
    </div>
  );
}
