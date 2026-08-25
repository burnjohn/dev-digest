/** Pure helpers for AgentPerformanceView — no React, unit-testable in
 *  isolation. All aggregation reuses ALREADY-COMPUTED `AgentStats` fields
 *  (the single source of truth is server-side `computeAgentStats`); nothing
 *  here re-derives accept/dismiss/cost from raw runs/findings. */
import type { Agent, AgentStats } from "@devdigest/shared";
import type { DonutSegment } from "@devdigest/ui";
import { DONUT_PALETTE, MIN_DECIDED_FOR_ACCEPT_SORT, type Period, type SortDir, type SortKey } from "./constants";

export interface PerformanceRow {
  agent: Agent;
  stats: AgentStats | undefined;
}

/** Resolve the period picker's selection into the `{since, until}` ISO pair
 *  `useAgentsStats` forwards as query params. "30 days" resolves to an
 *  EMPTY range (both undefined) on purpose — that is the server's own
 *  default window, so the query key collapses to the exact same
 *  `["agent-stats", agentId]` shape the per-agent Stats tab already uses,
 *  sharing its cache entry for that period instead of forking a second one. */
export function periodRange(
  period: Period,
  customSince?: string,
  customUntil?: string,
): { since?: string; until?: string } {
  if (period === "1d") {
    const now = new Date();
    return {
      since: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      until: now.toISOString(),
    };
  }
  if (period === "custom") {
    if (!customSince || !customUntil) return {};
    return {
      since: new Date(`${customSince}T00:00:00.000Z`).toISOString(),
      until: new Date(`${customUntil}T23:59:59.999Z`).toISOString(),
    };
  }
  return {}; // "30d" — server's own default window
}

/** Whether an agent has too few decided findings to trust its accept-rate
 *  for sorting (owner decision: accepted + dismissed >= 5). An agent with
 *  no stats loaded yet is treated as small-sample too — never a
 *  meaningless sort position. */
export function isSmallSample(stats: AgentStats | undefined): boolean {
  if (!stats) return true;
  return stats.accepted + stats.dismissed < MIN_DECIDED_FOR_ACCEPT_SORT;
}

export function sortRows(rows: PerformanceRow[], key: SortKey, dir: SortDir): PerformanceRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    switch (key) {
      case "agent":
        return a.agent.name.localeCompare(b.agent.name) * sign;
      case "runs":
        return ((a.stats?.runs ?? 0) - (b.stats?.runs ?? 0)) * sign;
      case "avgCost":
        return ((a.stats?.avg_cost_usd ?? -1) - (b.stats?.avg_cost_usd ?? -1)) * sign;
      case "avgDuration":
        return ((a.stats?.avg_latency_ms ?? -1) - (b.stats?.avg_latency_ms ?? -1)) * sign;
      case "lastRun": {
        const av = a.stats?.run_history[0]?.ran_at ?? "";
        const bv = b.stats?.run_history[0]?.ran_at ?? "";
        return av.localeCompare(bv) * sign;
      }
      case "acceptRate": {
        // Small-sample rows are flagged, never given an arbitrary position —
        // they always sink below every eligible row, in EITHER direction.
        const aSmall = isSmallSample(a.stats);
        const bSmall = isSmallSample(b.stats);
        if (aSmall !== bSmall) return aSmall ? 1 : -1;
        return ((a.stats?.accept_rate ?? -1) - (b.stats?.accept_rate ?? -1)) * sign;
      }
      default:
        return 0;
    }
  });
  return sorted;
}

export interface DashboardTotals {
  totalRuns: number;
  totalCost: number | null;
  /** Weighted (NOT an average-of-per-agent-rates) — sum(accepted) /
   *  sum(accepted+dismissed) across every agent in the current period, so a
   *  1000-run agent isn't drowned out by a 2-run agent's rate. */
  avgAcceptRate: number | null;
  decided: number;
  mostActive: { agentId: string; agentName: string; runs: number } | null;
}

export function computeDashboardTotals(statsList: AgentStats[]): DashboardTotals {
  const totalRuns = statsList.reduce((sum, s) => sum + s.runs, 0);
  const costs = statsList.map((s) => s.total_cost_usd).filter((v): v is number => v != null);
  const totalCost = costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0);
  const totalAccepted = statsList.reduce((sum, s) => sum + s.accepted, 0);
  const decided = statsList.reduce((sum, s) => sum + s.accepted + s.dismissed, 0);
  const avgAcceptRate = decided === 0 ? null : totalAccepted / decided;

  let mostActive: DashboardTotals["mostActive"] = null;
  for (const s of statsList) {
    if (!mostActive || s.runs > mostActive.runs) {
      mostActive = { agentId: s.agent_id, agentName: s.agent_name, runs: s.runs };
    }
  }

  return { totalRuns, totalCost, avgAcceptRate, decided, mostActive };
}

/** "Cost by agent" donut segments — one per agent with recorded cost.
 *  Deliberately excludes zero/null-cost agents rather than rendering a
 *  zero-width segment. */
export function costByAgentSegments(rows: PerformanceRow[]): DonutSegment[] {
  return rows
    .filter((r) => (r.stats?.total_cost_usd ?? 0) > 0)
    .map((r, i) => ({
      label: r.agent.name,
      value: r.stats!.total_cost_usd!,
      color: DONUT_PALETTE[i % DONUT_PALETTE.length]!,
    }));
}

/** "Cost by model" donut segments — agents sharing a model are grouped and
 *  their `total_cost_usd` summed. Sums to the SAME total as
 *  `costByAgentSegments` (both derive from the same `total_cost_usd`
 *  values, just grouped by a different dimension) — verified in this
 *  component's test. */
export function costByModelSegments(rows: PerformanceRow[]): DonutSegment[] {
  const byModel = new Map<string, number>();
  for (const r of rows) {
    const cost = r.stats?.total_cost_usd;
    if (!cost) continue;
    byModel.set(r.agent.model, (byModel.get(r.agent.model) ?? 0) + cost);
  }
  return [...byModel.entries()].map(([model, cost], i) => ({
    label: model,
    value: cost,
    color: DONUT_PALETTE[i % DONUT_PALETTE.length]!,
  }));
}

export function donutTotal(segments: DonutSegment[]): number {
  return segments.reduce((sum, seg) => sum + seg.value, 0);
}
