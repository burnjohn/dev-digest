import type { Container } from '../../platform/container.js';
import { AgentsRepository } from '../agents/repository.js';
import { RunsRepository } from '../runs/repository.js';
import type { AgentPerf, AgentPerfRow, Severity } from '@devdigest/shared';
import { DONE_STATUS } from './constants.js';
import {
  avgOrNull,
  costByAgent,
  costByModel,
  sortByAcceptRate,
  sumOrNull,
  trend,
} from './helpers.js';

/**
 * A6 — Agent Performance (§7/§12). `GET /agents/performance`.
 *
 * Aggregates across `agent_runs` + `findings` per agent (workspace-scoped),
 * reusing A5's read-only `RunsRepository`. The headline signal is accept-rate
 * (replaces the old "cost" emphasis, §7 L08); cost is shown as a breakdown.
 */
export class PerformanceService {
  private agents: AgentsRepository;
  private runs: RunsRepository;

  constructor(container: Container) {
    this.agents = new AgentsRepository(container.db);
    this.runs = new RunsRepository(container.db);
  }

  async performance(workspaceId: string): Promise<AgentPerf> {
    const agents = await this.agents.list(workspaceId);
    const rows: AgentPerfRow[] = [];

    for (const a of agents) {
      const runs = await this.runs.agentRunsForAgent(workspaceId, a.id);
      const findings = await this.runs.findingsForAgent(workspaceId, a.id);

      const accepted = findings.filter((f) => f.acceptedAt != null).length;
      const dismissed = findings.filter((f) => f.dismissedAt != null).length;
      const acted = accepted + dismissed;

      const bySeverity = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
      for (const f of findings) {
        if (f.severity === 'CRITICAL' || f.severity === 'WARNING' || f.severity === 'SUGGESTION') {
          bySeverity[f.severity as Severity] += 1;
        }
      }

      const done = runs.filter((r) => r.status === DONE_STATUS);
      const costs = done.map((r) => r.costUsd).filter((c): c is number => c != null);
      const totalCost = sumOrNull(costs);
      const avgLatencyRaw = avgOrNull(done.map((r) => r.durationMs));
      const avgLatency = avgLatencyRaw != null ? Math.round(avgLatencyRaw) : null;
      const avgFindings = avgOrNull(done.map((r) => r.findingsCount));
      const lastRun = runs.length
        ? runs
            .map((r) => r.ranAt)
            .filter((d): d is Date => d != null)
            .sort((x, y) => y.getTime() - x.getTime())[0] ?? null
        : null;

      rows.push({
        agent_id: a.id,
        agent_name: a.name,
        provider: a.provider,
        model: a.model,
        runs: runs.length,
        findings_total: findings.length,
        accepted,
        dismissed,
        accept_rate: acted > 0 ? accepted / acted : null,
        dismiss_rate: acted > 0 ? dismissed / acted : null,
        avg_findings_per_run: avgFindings,
        total_cost_usd: totalCost,
        avg_cost_usd: costs.length ? (totalCost ?? 0) / costs.length : null,
        avg_latency_ms: avgLatency,
        last_run_at: lastRun ? lastRun.toISOString() : null,
        findings_by_severity: bySeverity,
        trend: trend(runs),
      });
    }

    // Sort by accept-rate desc (nulls last) — the headline ordering for the page.
    const sorted = sortByAcceptRate(rows);

    const totalRuns = sorted.reduce((n, r) => n + r.runs, 0);
    const totalCost = sumOrNull(sorted.map((r) => r.total_cost_usd));
    const avgAccept = avgOrNull(sorted.map((r) => r.accept_rate));
    const mostActive = [...sorted].sort((a, b) => b.runs - a.runs)[0];

    return {
      summary: {
        runs: totalRuns,
        total_cost_usd: totalCost,
        avg_accept_rate: avgAccept,
        most_active_agent: mostActive && mostActive.runs > 0 ? mostActive.agent_name : null,
      },
      agents: sorted,
      cost_by_agent: costByAgent(sorted),
      cost_by_model: costByModel(sorted),
    };
  }
}
