import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentStats } from "@devdigest/shared";
import messages from "../../../../../messages/en/agentPerformance.json";

// AppShell pulls in repo-context/theme/shell hooks unrelated to this view —
// same passthrough-mock pattern as EvalDashboardView.test.tsx.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const AGENT_A: Agent = {
  id: "a1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "review",
  enabled: true,
  version: 1,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
};
const AGENT_B: Agent = {
  ...AGENT_A,
  id: "a2",
  name: "Perf Reviewer",
  model: "gpt-4.1", // same model as AGENT_A — exercises cost-by-model grouping
};

// High-volume agent, decided findings >= 5 (eligible for the accept-rate sort).
const STATS_A: AgentStats = {
  agent_id: "a1",
  agent_name: "Security Reviewer",
  runs: 50,
  findings_total: 55,
  accepted: 39,
  dismissed: 11,
  pending: 5,
  accept_rate: 0.78,
  dismiss_rate: 0.22,
  avg_findings_per_run: 1.1,
  total_cost_usd: 1.0,
  avg_cost_usd: 0.02,
  avg_latency_ms: 4000,
  findings_by_severity: { CRITICAL: 5, WARNING: 10, SUGGESTION: 40 },
  trend: [],
  most_used_skills: [],
  findings_by_category: [],
  run_history: [{ run_id: "r1", ran_at: "2026-08-20T00:00:00.000Z", pr_number: 10, tokens_in: 100, tokens_out: 50, cost_usd: 0.02, findings_count: 1, source: "local" }],
};

// Low-volume agent, decided findings < 5 (small-sample badge, excluded from
// the accept-rate sort's meaningful ordering).
const STATS_B: AgentStats = {
  agent_id: "a2",
  agent_name: "Perf Reviewer",
  runs: 2,
  findings_total: 1,
  accepted: 1,
  dismissed: 0,
  pending: 0,
  accept_rate: 1,
  dismiss_rate: 0,
  avg_findings_per_run: 0.5,
  total_cost_usd: 0.1,
  avg_cost_usd: 0.05,
  avg_latency_ms: 3000,
  findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 1 },
  trend: [],
  most_used_skills: [],
  findings_by_category: [],
  run_history: [{ run_id: "r2", ran_at: "2026-08-15T00:00:00.000Z", pr_number: 4, tokens_in: 50, tokens_out: 20, cost_usd: 0.05, findings_count: 1, source: "local" }],
};

let agentsFixture: Agent[] = [AGENT_A, AGENT_B];
let statsFixture: Record<string, AgentStats> = { a1: STATS_A, a2: STATS_B };

const useAgentsStatsSpy = vi.fn((agentIds: string[], range?: { since?: string; until?: string }) => {
  const map = new Map<string, AgentStats>();
  for (const id of agentIds) {
    const st = statsFixture[id];
    if (st) map.set(id, st);
  }
  return { data: map, isLoading: false, isError: false, refetch: vi.fn(), range };
});

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: agentsFixture }),
  useAgentsStats: (agentIds: string[], range?: { since?: string; until?: string }) =>
    useAgentsStatsSpy(agentIds, range),
}));

import { computeDashboardTotals, costByAgentSegments, costByModelSegments, donutTotal } from "./helpers";
import { AgentPerformanceView } from "./AgentPerformanceView";

afterEach(() => {
  cleanup();
  useAgentsStatsSpy.mockClear();
  agentsFixture = [AGENT_A, AGENT_B];
  statsFixture = { a1: STATS_A, a2: STATS_B };
});

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agentPerformance: messages }}>
      <AgentPerformanceView />
    </NextIntlClientProvider>,
  );
}

describe("AgentPerformanceView", () => {
  it("shows a loading skeleton (no fabricated numbers) while any per-agent query is pending", () => {
    useAgentsStatsSpy.mockImplementationOnce(() => ({
      data: new Map(),
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
      range: undefined,
    }));
    renderWithIntl();
    expect(screen.queryByText("Total runs")).not.toBeInTheDocument();
    expect(screen.queryByText("52")).not.toBeInTheDocument();
  });

  it("shows ErrorState with a retry action when any per-agent query errors", () => {
    const refetch = vi.fn();
    useAgentsStatsSpy.mockImplementationOnce(() => ({
      data: new Map(),
      isLoading: false,
      isError: true,
      refetch,
      range: undefined,
    }));
    renderWithIntl();
    expect(screen.getByText("Could not load agent performance.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows a distinct empty state when the workspace has zero agents", () => {
    agentsFixture = [];
    renderWithIntl();
    expect(screen.getByText("No agents yet")).toBeInTheDocument();
  });

  it("shows a distinct 'no runs in period' empty state when agents exist but nobody ran", () => {
    statsFixture = {
      a1: { ...STATS_A, runs: 0, total_cost_usd: null, accepted: 0, dismissed: 0, accept_rate: null, run_history: [] },
      a2: { ...STATS_B, runs: 0, total_cost_usd: null, accepted: 0, dismissed: 0, accept_rate: null, run_history: [] },
    };
    renderWithIntl();
    expect(screen.getByText("No runs in this period")).toBeInTheDocument();
    expect(screen.queryByText("No agents yet")).not.toBeInTheDocument();
  });

  it("computes Total runs and weighted avg accept-rate matching a hand-computed value", () => {
    renderWithIntl();
    // Total runs: 50 + 2 = 52.
    expect(screen.getByText("52")).toBeInTheDocument();
    // Weighted accept-rate: (39 accepted + 1 accepted) / (50 decided + 1 decided) = 40/51 ≈ 78%.
    // NOT an average of the two per-agent rates (78% and 100% → would be 89%).
    expect(screen.getByText("78%")).toBeInTheDocument();
  });

  it("flags the low-volume agent with a small-sample badge and marks the high-volume one eligible", () => {
    renderWithIntl();
    expect(screen.getByText("small sample")).toBeInTheDocument();
    // Only ONE small-sample badge — the high-volume agent (50 runs, 50 decided) isn't flagged.
    expect(screen.getAllByText("small sample")).toHaveLength(1);
  });

  it("Total cost tile equals the sum of both cost-breakdown donuts' segments", () => {
    renderWithIntl();
    // Total cost: $1.00 + $0.10 = $1.10. Both agents share one model, so the
    // "cost by model" donut collapses to a single segment whose legend value
    // is ALSO "$1.10" — scope the query to the Total Cost tile (identified by
    // its "Total cost" label) so it doesn't collide with that donut segment.
    // MetricCard renders the label and the value in two sibling divs under one
    // outer wrapping div — .closest("div") on the label span lands on the
    // inner header div (label-only), not the tile as a whole, so go up one
    // more level to the outer div that actually contains both.
    const totalCostTile = screen.getByText("Total cost").closest("div")!.parentElement!;
    expect(within(totalCostTile).getByText("$1.10")).toBeInTheDocument();

    const rows = [
      { agent: AGENT_A, stats: STATS_A },
      { agent: AGENT_B, stats: STATS_B },
    ];
    const byAgent = costByAgentSegments(rows);
    const byModel = costByModelSegments(rows);
    // Both agents share the same model (gpt-4.1) — "cost by model" collapses
    // to a single segment; "cost by agent" has two. Both sum to the SAME
    // total as the "Total cost" tile — no drift between the two breakdowns.
    expect(byAgent).toHaveLength(2);
    expect(byModel).toHaveLength(1);
    const totals = computeDashboardTotals([STATS_A, STATS_B]);
    expect(donutTotal(byAgent)).toBeCloseTo(totals.totalCost!);
    expect(donutTotal(byModel)).toBeCloseTo(totals.totalCost!);
  });

  it("clicking a column header re-orders rows client-side, without firing a new per-agent stats query", () => {
    renderWithIntl();
    // Sortable <th>s carry role="button" (see AgentPerformanceView.tsx) so
    // this and every row-order assertion below query via role, not raw
    // querySelector/getByText, per this client's RTL query-priority
    // convention.
    const rowAgentNames = () =>
      screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent);

    // Default sort is Runs desc: Security Reviewer (50) before Perf Reviewer (2).
    expect(rowAgentNames()).toEqual(["Security Reviewer", "Perf Reviewer"]);

    const argsBefore = useAgentsStatsSpy.mock.calls.at(-1);
    fireEvent.click(screen.getByRole("button", { name: /^Runs/ })); // toggles the already-active Runs sort to ascending; header already shows "Runs ▼" by default
    const argsAfter = useAgentsStatsSpy.mock.calls.at(-1);

    // Rows visibly re-order...
    expect(rowAgentNames()).toEqual(["Perf Reviewer", "Security Reviewer"]);
    // ...but the hook is re-invoked with the SAME (agentIds, range) arguments
    // — i.e. the same React Query cache key, proving sort never triggers a
    // new/different network query.
    expect(argsAfter).toEqual(argsBefore);
  });

  it("an agent below the small-sample threshold sinks to the bottom of the accept-rate sort rather than an arbitrary position", () => {
    renderWithIntl();
    fireEvent.click(screen.getByRole("button", { name: "Accept rate" }));
    const rowAgentNames = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    // Perf Reviewer (small sample, decided=1) always sinks below Security
    // Reviewer (eligible, decided=50) regardless of sort direction.
    expect(rowAgentNames).toEqual(["Security Reviewer", "Perf Reviewer"]);
  });
});
