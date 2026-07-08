import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalBatch, EvalTrendPointV2, EvalKpiDeltaResponse, EvalAgentSummary } from "@devdigest/shared";
import evalsMessages from "../../../../../messages/en/evals.json";
import agentsMessages from "../../../../../messages/en/agents.json";

// ---- Mocks -----------------------------------------------------------------

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

let agent: Agent | undefined;
let agentIsLoading = false;
let agentIsError = false;
const agentRefetch = vi.fn();

vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => ({ data: agent, isLoading: agentIsLoading, isError: agentIsError, error: null, refetch: agentRefetch }),
}));

let batches: EvalBatch[] = [];
let trendPoints: EvalTrendPointV2[] = [];
let kpiDelta: EvalKpiDeltaResponse | undefined = null;
let overview: EvalAgentSummary[] = [];

vi.mock("@/lib/hooks/eval", () => ({
  useEvalBatchHistory: () => ({ data: batches, isLoading: false }),
  useEvalTrend: () => ({ data: trendPoints, isLoading: false }),
  useEvalKpiDelta: () => ({ data: kpiDelta, isLoading: false }),
  useEvalOverview: () => ({ data: overview, isLoading: false }),
  useEvalRecentAcrossAgents: () => ({ data: [], isLoading: false }),
  // BatchHistoryTable (rendered for real by EvalDetailView) also calls these
  // two hooks internally — mock them here too, per the client insights
  // 2026-07-05 "unrelated hooks up the render tree" gotcha. Batch detail data
  // is returned only for the batch id BatchHistoryTable actually expands, so
  // the pre-expand test below can assert on real drilldown content.
  useEvalBatchDetail: (_agentId: string | null | undefined, batchId: string | null | undefined) => ({
    data:
      batchId === "b2"
        ? {
            id: "b2",
            agent_id: "ag1",
            kind: "full",
            status: "clean",
            agent_snapshot: {},
            recall: 0.9,
            precision: 0.85,
            citation_accuracy: 0.95,
            cost_usd: 0.02,
            ran_at: "2026-07-05T00:00:00.000Z",
            system_prompt_snapshot: null,
            cases: [],
            excluded_skill_owned_count: 0,
          }
        : undefined,
    isLoading: false,
  }),
  useEvalCompare: () => ({ data: undefined, isLoading: false }),
  // "Run eval" button (AC-17) — the detail view fires a full-set run and polls
  // it to completion; both hooks are inert in these render tests.
  useRunEvalBatch: () => ({ mutate: vi.fn(), isPending: false }),
  useEvalRunCompletion: () => ({ data: undefined }),
}));

import { EvalDetailView } from "./EvalDetailView";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evals: evalsMessages, agents: agentsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function makeBatch(overrides: Partial<EvalBatch> = {}): EvalBatch {
  return {
    id: "b1",
    agent_id: "ag1",
    kind: "full",
    status: "clean",
    agent_snapshot: { fingerprint: "abc123def456", display: { model: "gpt-4.1" } },
    recall: 0.9,
    precision: 0.85,
    citation_accuracy: 0.95,
    cost_usd: 0.02,
    ran_at: "2026-07-06T00:00:00.000Z",
    system_prompt_snapshot: null,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<EvalAgentSummary> = {}): EvalAgentSummary {
  return {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    model: "gpt-4.1",
    latest_batch: makeBatch(),
    latest_version: 1,
    sparkline_points: [],
    case_count: 5,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  push.mockClear();
  agentRefetch.mockClear();
  agent = undefined;
  agentIsLoading = false;
  agentIsError = false;
  batches = [];
  trendPoints = [];
  kpiDelta = null;
  overview = [];
});

describe("EvalDetailView", () => {
  it("composes agent name/model/subtitle + metrics + trend + batch history (AC-14)", () => {
    agent = AGENT;
    batches = [makeBatch()];
    trendPoints = [
      { batch_id: "b1", ran_at: "2026-07-06T00:00:00.000Z", recall: 0.9, precision: 0.85, citation_accuracy: 0.95, is_degraded: false, agent_snapshot: {}, cost_usd: 0.02 },
    ];
    overview = [makeSummary()];

    renderWithIntl(<EvalDetailView agentId="ag1" preselectBatchId={null} />);

    expect(screen.getByRole("heading", { name: "Security Reviewer" })).toBeInTheDocument();
    expect(screen.getByText("Regression harness · 1 run(s) on the 5-case gold set")).toBeInTheDocument();
    // Model now lives in a badge beside the title (not the subtitle). It also
    // appears in the batch-history Model column, hence getAllByText.
    expect(screen.getAllByText("gpt-4.1").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Run eval" })).toBeInTheDocument();
    expect(screen.getByText("Recent runs")).toBeInTheDocument();
    expect(screen.getByText("Metric trend")).toBeInTheDocument();
  });

  it("shows a loading skeleton while any dependent query is loading", () => {
    agentIsLoading = true;
    const { container } = renderWithIntl(<EvalDetailView agentId="ag1" preselectBatchId={null} />);
    expect(container.querySelectorAll('[class*="skeleton"], [style]').length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("shows an error state when the agent fails to load", () => {
    agentIsError = true;
    renderWithIntl(<EvalDetailView agentId="ag1" preselectBatchId={null} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("pre-expands the batch given via preselectBatchId (AC-10)", () => {
    agent = AGENT;
    batches = [makeBatch({ id: "b1" }), makeBatch({ id: "b2", ran_at: "2026-07-05T00:00:00.000Z" })];
    overview = [makeSummary()];

    renderWithIntl(<EvalDetailView agentId="ag1" preselectBatchId="b2" />);

    // The drilldown table (case/outcome headers) only renders for the
    // expanded row — presence confirms pre-expansion happened on mount.
    expect(screen.getByText("Case")).toBeInTheDocument();
  });
});
