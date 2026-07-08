import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentSummary, EvalRecentBatchRow } from "@devdigest/shared";
import evalsMessages from "../../../../../messages/en/evals.json";

// ---- Mocks -----------------------------------------------------------------

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

let overview: EvalAgentSummary[] = [];
let recent: EvalRecentBatchRow[] = [];
const runAllMutate = vi.fn();
let runAllIsPending = false;

vi.mock("@/lib/hooks/eval", () => ({
  useEvalOverview: () => ({ data: overview, isLoading: false, isError: false, refetch: vi.fn() }),
  useEvalRecentAcrossAgents: () => ({ data: recent, isLoading: false }),
  useRunAllAgents: () => ({ mutate: runAllMutate, isPending: runAllIsPending }),
}));

import { EvalsLandingView } from "./EvalsLandingView";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evals: evalsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeSummary(overrides: Partial<EvalAgentSummary> = {}): EvalAgentSummary {
  return {
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    model: "gpt-4.1",
    latest_batch: {
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
    },
    sparkline_points: [
      { ran_at: "2026-07-01T00:00:00.000Z", recall: 0.8 },
      { ran_at: "2026-07-06T00:00:00.000Z", recall: 0.9 },
    ],
    latest_version: 2,
    case_count: 5,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  overview = [];
  recent = [];
  runAllMutate.mockClear();
  runAllIsPending = false;
});

describe("EvalsLandingView", () => {
  it("renders the empty state with no 'Run all agents' button when overview is empty (AC-5)", () => {
    overview = [];
    renderWithIntl(<EvalsLandingView />);

    expect(screen.getByText("No agents configured for evals yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run all agents" })).not.toBeInTheDocument();
  });

  it("renders an AgentCard per agent, plus the Run all agents button and the recent-runs feed", () => {
    overview = [makeSummary()];
    recent = [
      {
        batch: {
          id: "b1",
          agent_id: "ag1",
          kind: "full",
          status: "clean",
          agent_snapshot: {},
          recall: 0.9,
          precision: 0.85,
          citation_accuracy: 0.95,
          cost_usd: 0.02,
          ran_at: "2026-07-06T00:00:00.000Z",
          system_prompt_snapshot: null,
        },
        agent_id: "ag1",
        agent_name: "Security Reviewer",
        version: 2,
        pass_count: 4,
        total_count: 5,
      },
    ];
    renderWithIntl(<EvalsLandingView />);

    expect(screen.getByTestId("agent-card-ag1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all agents" })).toBeInTheDocument();
    expect(screen.getByText("Recent eval runs · all agents")).toBeInTheDocument();
    expect(screen.getByTestId("recent-run-row-b1")).toBeInTheDocument();
  });
});
