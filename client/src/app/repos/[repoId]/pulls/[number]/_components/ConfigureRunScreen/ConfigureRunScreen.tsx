/* ConfigureRunScreen — SPEC-07 T10 (G1). Inline picker rendered INSIDE the
   Multi-Agent Review tab (not a modal — the spec's own Non-goals note there
   is no design mockup artboard for this screen, only behavior/AC-5..9).
   Every workspace agent gets a row (enabled AND disabled — same "show all"
   precedent as `RunReviewDropdown.tsx:54-61`), checked by default to that
   agent's own `enabled` flag. Checking here never persists `agent.enabled` —
   it only selects this one run's target subset. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, SectionLabel } from "@devdigest/ui";
import { formatUsd } from "@/components/run-cost-badge";
import { useAgents, useAgentsStats } from "@/lib/hooks/agents";
import { useRunReview } from "@/lib/hooks/reviews";
import { formatEstimatedTime } from "./helpers";
import { s } from "./styles";
import type { Agent } from "@devdigest/shared";

interface ConfigureRunScreenProps {
  prId: string;
  onCancel: () => void;
  /** Fired once the run request settles successfully — `runGroupId` is the
   *  new `multi_agent_runs.id` (`null` when exactly one agent was checked,
   *  AC-15) so the caller can switch back to the Columns view of that group
   *  (AC-9). `runIds` is always populated (1+ entries) — the caller's
   *  fallback for the `runGroupId === null` case (SPEC-07's own Edge cases:
   *  a single-agent submission must still show that one result, not go
   *  back to whatever group was showing before). */
  onSubmitted: (runGroupId: string | null, runIds: string[]) => void;
}

export function ConfigureRunScreen({ prId, onCancel, onSubmitted }: ConfigureRunScreenProps) {
  const t = useTranslations("prReview");
  const { data: agents, isLoading } = useAgents();
  const all = agents ?? [];
  const { data: statsMap } = useAgentsStats(all.map((a) => a.id));
  const run = useRunReview();

  // Per-agent override of the default `agent.enabled` checked-state; an agent
  // absent from this map falls back to its own `enabled` flag (AC-5).
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({});
  const isChecked = (agent: Agent) => overrides[agent.id] ?? agent.enabled;
  const toggle = (agent: Agent) =>
    setOverrides((prev) => ({ ...prev, [agent.id]: !isChecked(agent) }));

  const checkedAgents = all.filter(isChecked);
  const n = checkedAgents.length;

  // AC-6: sum of avg_cost_usd of checked agents; an agent with no run history
  // (avg_cost_usd: null) contributes nothing to the sum.
  const costTotal = checkedAgents.reduce(
    (sum, a) => sum + (statsMap.get(a.id)?.avg_cost_usd ?? 0),
    0,
  );
  const anyCheckedHasCost = checkedAgents.some((a) => statsMap.get(a.id)?.avg_cost_usd != null);
  // AC-7: MAX (not sum) of avg_latency_ms among checked agents — they run
  // concurrently (G2), so the slowest one bounds the total wall time.
  const latencies = checkedAgents
    .map((a) => statsMap.get(a.id)?.avg_latency_ms)
    .filter((v): v is number => v != null);
  const timeEstimateMs = latencies.length > 0 ? Math.max(...latencies) : null;

  const handleSubmit = async () => {
    if (n === 0) return;
    const res = await run.mutateAsync({ prId, agentIds: checkedAgents.map((a) => a.id) });
    onSubmitted(res.run_group_id, res.runs.map((r) => r.run_id));
  };

  return (
    <section style={s.root}>
      <div style={s.header}>
        <span style={s.title}>{t("configureRun.title")}</span>
        <Button kind="ghost" size="sm" icon="X" onClick={onCancel}>
          {t("configureRun.cancel")}
        </Button>
      </div>

      <SectionLabel icon="Cpu">{t("configureRun.agentsLabel")}</SectionLabel>

      {isLoading ? null : all.length === 0 ? (
        <EmptyState icon="Cpu" title={t("configureRun.noAgentsTitle")} />
      ) : (
        <div style={s.rows}>
          {all.map((agent) => {
            const stats = statsMap.get(agent.id);
            const hasHistory = stats?.avg_cost_usd != null;
            return (
              <div key={agent.id} style={s.row}>
                <Checkbox checked={isChecked(agent)} onChange={() => toggle(agent)} />
                {/* A sibling of the checkbox (not a wrapping ancestor) — clicking
                    it toggles without double-firing via bubbling into the
                    checkbox's own click handler. Widens the click target
                    beyond the small checkbox square. */}
                <div
                  style={{ ...s.rowMeta, cursor: "pointer" }}
                  onClick={() => toggle(agent)}
                >
                  <span style={s.rowName}>{agent.name}</span>
                  <span className="mono" style={s.rowModel}>
                    {agent.provider}/{agent.model}
                    {!agent.enabled ? ` · ${t("configureRun.disabled")}` : ""}
                  </span>
                </div>
                <span style={s.rowStats}>
                  {hasHistory
                    ? `${formatUsd(stats?.avg_cost_usd ?? null)} · ${formatEstimatedTime(stats?.avg_latency_ms ?? null)}`
                    : t("configureRun.noRunHistory")}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={s.footer}>
        <div style={s.estimates}>
          <span>
            {t("configureRun.estimatedCost")}: {anyCheckedHasCost ? formatUsd(costTotal) : "—"}
          </span>
          <span>
            {t("configureRun.estimatedTime")}: {formatEstimatedTime(timeEstimateMs)}
          </span>
        </div>
        <div style={s.actions}>
          <Button
            kind="primary"
            icon="Sparkles"
            disabled={n === 0}
            loading={run.isPending}
            onClick={handleSubmit}
          >
            {t("configureRun.runButton", { count: n })}
          </Button>
        </div>
      </div>
    </section>
  );
}
