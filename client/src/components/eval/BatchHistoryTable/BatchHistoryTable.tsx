"use client";

/* BatchHistoryTable — batch runs (timestamp, agent-snapshot identity, model,
   the three metrics, cost, status pill). Clicking a row expands an inline
   per-case drill-down (AC-33, via useEvalBatchDetail). Selecting exactly two
   rows renders BatchCompare inline underneath (AC-32). */

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Checkbox, Button, Icon } from "@devdigest/ui";
import type { EvalBatch } from "@devdigest/shared";
import { formatCost } from "@/lib/format";
import { useEvalBatchDetail, useEvalCompare } from "@/lib/hooks/eval";
import { BatchCompare } from "../BatchCompare/BatchCompare";
import { CompareModal } from "../CompareModal/CompareModal";
import { modelLabelFrom, snapshotLabel, pct } from "../helpers";
import { s } from "../styles";

/** Pass/total for a batch, keyed by batch id — supplied by the dashboard
 *  detail page (joined client-side from the recent feed) for the `barMetrics`
 *  presentation's PASS column. */
export type PassByBatchId = Map<string, { pass: number; total: number }>;

/** A metric value as a small colored progress bar + its percentage — the
 *  dashboard ("barMetrics") presentation of recall/precision/citation. */
function MetricBar({ value, color }: { value: number | null; color: string }) {
  return (
    <div style={barStyles.cell}>
      <div style={barStyles.track}>
        <div style={{ ...barStyles.fill, width: `${Math.round((value ?? 0) * 100)}%`, background: color }} />
      </div>
      <span style={barStyles.pct}>{pct(value)}</span>
    </div>
  );
}

const barStyles = {
  cell: { display: "flex", alignItems: "center", gap: 8 } as const,
  track: { width: 88, height: 8, borderRadius: 4, background: "var(--bg-hover)", overflow: "hidden", flexShrink: 0 } as const,
  fill: { height: "100%", borderRadius: 4 } as const,
  pct: { fontSize: 12, color: "var(--text-secondary)", minWidth: 34, fontVariantNumeric: "tabular-nums" } as const,
  version: { fontSize: 12, fontWeight: 600, color: "var(--accent)", fontFamily: "var(--font-mono, ui-monospace, monospace)" } as const,
};

interface BatchHistoryTableProps {
  agentId: string;
  batches: EvalBatch[];
  /** Batch id to highlight + scroll into view — driven by TrendChart hover so
   *  the chart links to THIS table instead of duplicating its details. */
  highlightBatchId?: string | null;
  /** Batch id to pre-expand (and scroll to) on mount — used by the Eval
   *  Dashboard detail page when arriving via a `?batch=` link from the
   *  cross-agent recent-runs feed (AC-10). Backward-compatible: when
   *  omitted, `expandedId` starts `null` exactly as before (the per-agent
   *  Evals tab's existing call site passes nothing). */
  preselectBatchId?: string;
  /** When true, exactly-2-selected compare renders a "Compare" button that
   *  opens `CompareModal` (Agent Eval Dashboard detail page, AC-18) instead
   *  of the inline `BatchCompare` panel. Defaults to false/unset — the
   *  per-agent Evals tab's existing inline-compare behavior is unchanged
   *  when this prop is omitted. */
  useModalCompare?: boolean;
  /** When true, render the dashboard presentation matching the mockup:
   *  RAN AT · VERSION · colored RECALL/PRECISION/CITATION bars · PASS · COST
   *  (no Model/Agent-snapshot/Status columns). Defaults to false — the
   *  per-agent Evals tab keeps its existing text/columns layout. */
  barMetrics?: boolean;
  /** Pass/total per batch for the `barMetrics` PASS column (see `PassByBatchId`). */
  passByBatchId?: PassByBatchId;
  /** `batchId → PROMPT version` (bumps only when the system-prompt text
   *  changes; batches predating prompt tracking are absent → rendered "—").
   *  Feeds the VERSION column. */
  versionByBatchId?: Map<string, number>;
  /** Optional section title rendered on the same header row as the always-on
   *  Compare button (dashboard detail page). When omitted, no title is shown. */
  headerTitle?: string;
}

export function BatchHistoryTable({
  agentId,
  batches,
  highlightBatchId,
  preselectBatchId,
  useModalCompare,
  barMetrics,
  passByBatchId,
  versionByBatchId,
  headerTitle,
}: BatchHistoryTableProps) {
  const t = useTranslations("agents");
  const [expandedId, setExpandedId] = React.useState<string | null>(preselectBatchId ?? null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const rowRefs = React.useRef<Map<string, HTMLTableRowElement>>(new Map());

  // Scroll the chart-hovered batch into view. `?.()` on the method — jsdom
  // (tests) doesn't implement scrollIntoView, so it no-ops there.
  React.useEffect(() => {
    if (highlightBatchId) rowRefs.current.get(highlightBatchId)?.scrollIntoView?.({ block: "nearest" });
  }, [highlightBatchId]);

  // Scroll the pre-expanded (via `?batch=`) row into view once on mount.
  React.useEffect(() => {
    if (preselectBatchId) rowRefs.current.get(preselectBatchId)?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detail = useEvalBatchDetail(agentId, expandedId);

  // S2 — compare is only meaningful between two "full" batches (same case
  // set, run to completion); a calibration batch's subset of cases and a
  // full batch's complete set are disjoint, so a signed delta between them
  // is not comparable. Restrict selection to full-kind batches only.
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
  // In modal-compare mode (Agent Eval Dashboard detail page), CompareModal
  // fetches the comparison itself once opened — avoid a redundant inline
  // fetch here by not passing the ids (the hook's own `enabled` flag no-ops
  // on undefined ids).
  const compare = useEvalCompare(agentId, useModalCompare ? undefined : batchIdA, useModalCompare ? undefined : batchIdB);
  const [modalOpen, setModalOpen] = React.useState(false);

  // Dashboard presentation shows real test attempts only — calibration
  // (subset) batches are hidden here (they still appear on the agent's own
  // Evals tab). The per-agent tab's default layout is unchanged.
  const displayBatches = barMetrics ? batches.filter((b) => b.kind === "full") : batches;

  if (displayBatches.length === 0) {
    return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("evals.history.empty")}</div>;
  }

  return (
    <div>
      {useModalCompare && (
        <div style={s.compareHeader}>
          <div style={s.compareHeaderLeft}>
            {headerTitle && (
              <span style={s.compareHeaderTitle}>
                <Icon.Clock size={13} />
                {headerTitle}
              </span>
            )}
            <span style={s.compareHeaderHint}>
              {selected.length === 0
                ? t("evals.history.selectTwoToCompare")
                : t("evals.history.nSelected", { count: selected.length })}
            </span>
          </div>
          <Button
            kind="primary"
            size="sm"
            disabled={selected.length !== 2}
            onClick={() => setModalOpen(true)}
          >
            {t("evals.history.compare")}
          </Button>
        </div>
      )}
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}></th>
            <th style={s.th}>{t("evals.history.timestamp")}</th>
            {barMetrics ? (
              <th style={s.th}>{t("evals.history.version")}</th>
            ) : (
              <>
                <th style={s.th}>{t("evals.history.agentSnapshot")}</th>
                <th style={s.th}>{t("evals.history.model")}</th>
              </>
            )}
            <th style={s.th}>{t("evals.history.recall")}</th>
            <th style={s.th}>{t("evals.history.precision")}</th>
            <th style={s.th}>{t("evals.history.citationAccuracy")}</th>
            {barMetrics && <th style={s.th}>{t("evals.history.passing")}</th>}
            <th style={s.th}>{t("evals.history.cost")}</th>
            {!barMetrics && <th style={s.th}>{t("evals.history.status")}</th>}
          </tr>
        </thead>
        <tbody>
          {displayBatches.map((batch) => {
            const isCalibration = batch.kind === "calibration";
            // #6 — a full-kind batch with `status === null` is in-flight or
            // crash-orphaned, NOT genuinely clean; it must render as a
            // distinct neutral "Running/Incomplete" state instead of falling
            // through to the green Clean pill.
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
            const isExpanded = expandedId === batch.id;
            // S2 — only full-kind batches are selectable for compare.
            const selectable = batch.kind === "full";
            const counts = passByBatchId?.get(batch.id);
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
                  {barMetrics ? (
                    <>
                      <td style={s.td}>
                        <span style={barStyles.version}>
                          {versionByBatchId?.get(batch.id) != null ? `v${versionByBatchId.get(batch.id)}` : "—"}
                        </span>
                      </td>
                      <td style={s.td}>
                        <MetricBar value={batch.recall} color="var(--accent)" />
                      </td>
                      <td style={s.td}>
                        <MetricBar value={batch.precision} color="var(--ok)" />
                      </td>
                      <td style={s.td}>
                        <MetricBar value={batch.citation_accuracy} color="var(--warn)" />
                      </td>
                      <td style={{ ...s.td, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {counts ? `${counts.pass}/${counts.total}` : "—"}
                      </td>
                      <td style={s.td}>{formatCost(batch.cost_usd)}</td>
                    </>
                  ) : (
                    <>
                      <td style={s.td} title={snapshotLabel(batch.agent_snapshot)}>
                        {snapshotLabel(batch.agent_snapshot)}
                      </td>
                      <td style={s.td}>{modelLabelFrom(batch.agent_snapshot)}</td>
                      <td style={s.td}>{pct(batch.recall)}</td>
                      <td style={s.td}>{pct(batch.precision)}</td>
                      <td style={s.td}>{pct(batch.citation_accuracy)}</td>
                      <td style={s.td}>{formatCost(batch.cost_usd)}</td>
                      <td style={s.td}>
                        <Badge color={statusColor}>{statusLabel}</Badge>
                      </td>
                    </>
                  )}
                </tr>
                {isExpanded && (
                  <tr>
                    <td style={s.td} colSpan={barMetrics ? 8 : 9}>
                      <div style={s.drilldownWrap}>
                        {detail.isLoading && <span style={{ fontSize: 12 }}>…</span>}
                        {detail.data && (
                          <table style={s.table}>
                            <thead>
                              <tr>
                                <th style={s.th}>{t("evals.history.drilldown.case")}</th>
                                <th style={s.th}>{t("evals.history.drilldown.outcome")}</th>
                                <th style={s.th}>{t("evals.history.drilldown.expected")}</th>
                                <th style={s.th}>{t("evals.history.drilldown.matched")}</th>
                                <th style={s.th}>{t("evals.history.drilldown.findings")}</th>
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
                                  <td style={s.td}>{c.expected_count}</td>
                                  <td style={s.td}>{c.matched_count}</td>
                                  <td style={s.td}>{c.findings_count}</td>
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

      {/* Inline-compare mode (per-agent Evals tab): the compare hint/panel stay
          below the table. In modal-compare mode the Compare button lives in the
          always-visible header above the table instead. */}
      {!useModalCompare && selected.length === 1 && (
        <div style={{ ...s.note, marginTop: 10 }}>{t("evals.history.selectTwoHint")}</div>
      )}
      {selected.length === 2 && !useModalCompare && compare.data && <BatchCompare result={compare.data} />}

      {modalOpen && batchIdA && batchIdB && (
        <CompareModal
          agentId={agentId}
          batchIdA={batchIdA}
          batchIdB={batchIdB}
          batches={batches}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
