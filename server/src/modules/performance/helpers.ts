import type { AgentPerfRow, PerfCostSegment } from '@devdigest/shared';
import type { AgentRunRow } from '../runs/repository.js';
import { TREND_WINDOW } from './constants.js';

/**
 * Pure aggregation helpers for the agent-performance module. No I/O — they take
 * already-loaded rows and compute the page's derived metrics. Behaviour-
 * identical to the previous inline implementations in PerformanceService.
 */

/** Per-agent trend = findings count of the most recent runs (capped window). */
export function trend(runs: AgentRunRow[]): number[] {
  return runs.slice(-TREND_WINDOW).map((r) => r.findingsCount ?? 0);
}

/** Sort rows by accept-rate descending, nulls last (the page's headline order). */
export function sortByAcceptRate(rows: AgentPerfRow[]): AgentPerfRow[] {
  return [...rows].sort((a, b) => (b.accept_rate ?? -1) - (a.accept_rate ?? -1));
}

/** Sum the non-null numbers in a list, or null when there are none. */
export function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((n, v) => n + v, 0) : null;
}

/** Average the non-null numbers in a list, or null when there are none. */
export function avgOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((n, v) => n + v, 0) / present.length : null;
}

/** Cost-by-agent segments (agents with positive cost only). */
export function costByAgent(rows: AgentPerfRow[]): PerfCostSegment[] {
  return rows
    .filter((r) => (r.total_cost_usd ?? 0) > 0)
    .map((r) => ({ label: r.agent_name, value: r.total_cost_usd ?? 0 }));
}

/** Cost-by-model segments (summed across agents sharing a model). */
export function costByModel(rows: AgentPerfRow[]): PerfCostSegment[] {
  const byModel = new Map<string, number>();
  for (const r of rows) {
    if (r.total_cost_usd != null && r.model) {
      byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.total_cost_usd);
    }
  }
  return [...byModel.entries()].map(([label, value]) => ({ label, value }));
}
