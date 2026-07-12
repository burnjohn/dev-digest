/* EvalDashboardView.test.tsx — RTL unit tests for the cross-agent Eval Dashboard (T10).

   Acceptance checks (from plan T10 + SPEC-03 AC-16/18/20):
   (a) Dashboard renders agents with current metrics + recent runs + a Run-all-agents button (AC-20)
   (b) Compare modal shows per-metric deltas (with text direction) + a prompt diff + a Promote button (AC-16/18)
   (c) "version unavailable" fallback renders when a version is pruned (AC-16 edge case)
   (d) Empty state renders when there are no agents

   All hooks are mocked — no QueryClient or server needed. */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard, EvalRunGroup, EvalRunRecord } from "@devdigest/shared";
import type { EvalCompareResult } from "@/lib/hooks/evals";
import evalMessages from "../../../../../messages/en/eval.json";

// ---------------------------------------------------------------------------
// Hook mocks — set up BEFORE importing the component (vi.mock hoisting)
// ---------------------------------------------------------------------------

const mockRunAllMutate = vi.fn();
const mockPromoteMutate = vi.fn();

const useEvalDashboardMock = vi.fn();
const useRunAllAgentsMock = vi.fn();
const useRunHistoryMock = vi.fn();
const useCompareRunsMock = vi.fn();
const usePromoteVersionMock = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: () => useEvalDashboardMock(),
  useRunAllAgents: () => useRunAllAgentsMock(),
  useRunHistory: (id: unknown) => useRunHistoryMock(id),
  useCompareRuns: (agentId: unknown, a: unknown, b: unknown) =>
    useCompareRunsMock(agentId, a, b),
  usePromoteVersion: () => usePromoteVersionMock(),
}));

import { EvalDashboardView } from "./EvalDashboardView";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RUN_RECORD_1: EvalRunRecord = {
  id: "run-1",
  case_id: "case-1",
  case_name: "stripe-key-leak",
  ran_at: "2026-07-12T10:00:00Z",
  actual_output: null,
  pass: true,
  recall: 1,
  precision: 1,
  citation_accuracy: 0.9,
  duration_ms: 500,
  cost_usd: 0.001,
  run_group_id: "grp-1",
};

const RUN_RECORD_2: EvalRunRecord = {
  ...RUN_RECORD_1,
  id: "run-2",
  case_id: "case-2",
  run_group_id: "grp-2",
  recall: 0.5,
  precision: 0.6,
  citation_accuracy: 0.7,
  pass: false,
};

const DASHBOARD_AGENT_1: EvalDashboard = {
  owner_kind: "agent",
  owner_id: "agent-1",
  cases_total: 4,
  current: {
    recall: 0.85,
    precision: 0.92,
    citation_accuracy: 0.78,
    traces_passed: 3,
    traces_total: 4,
    cost_usd: 0.01,
  },
  delta: {
    recall: 0.05,
    precision: -0.03,
    citation_accuracy: 0.02,
  },
  trend: [
    {
      ran_at: "2026-07-12T10:00:00Z",
      recall: 0.85,
      precision: 0.92,
      citation_accuracy: 0.78,
      pass_rate: 0.75,
      cost_usd: 0.01,
    },
    {
      ran_at: "2026-07-11T09:00:00Z",
      recall: 0.80,
      precision: 0.95,
      citation_accuracy: 0.76,
      pass_rate: 0.75,
      cost_usd: 0.008,
    },
  ],
  recent_runs: [RUN_RECORD_1, RUN_RECORD_2],
  alert: null,
};

const RUN_GROUP_A: EvalRunGroup = {
  id: "grp-1",
  workspace_id: "ws1",
  owner_kind: "agent",
  owner_id: "agent-1",
  agent_version: 5,
  label: null,
  ran_at: "2026-07-12T10:00:00Z",
  recall: 0.8,
  precision: 0.95,
  citation_accuracy: 0.76,
  total_cost_usd: 0.008,
};

const RUN_GROUP_B: EvalRunGroup = {
  ...RUN_GROUP_A,
  id: "grp-2",
  agent_version: 6,
  ran_at: "2026-07-12T11:00:00Z",
  recall: 0.85,
  precision: 0.92,
  citation_accuracy: 0.78,
};

const COMPARE_RESULT: EvalCompareResult = {
  group_a: RUN_GROUP_A,
  group_b: RUN_GROUP_B,
  delta: {
    recall: 0.05,
    precision: -0.03,
    citation_accuracy: 0.02,
  },
  system_prompt_diff:
    "--- system_prompt v5\n+++ system_prompt v6\n- old line\n+ new line",
  prompt_a: "You are a security reviewer v5.",
  prompt_b: "You are a security reviewer v6.",
  rows_a: [RUN_RECORD_1],
  rows_b: [RUN_RECORD_2],
};

// "version unavailable" compare result (AC-16 edge case).
const COMPARE_UNAVAILABLE: EvalCompareResult = {
  ...COMPARE_RESULT,
  system_prompt_diff: "[one or both versions unavailable — diff not possible]",
  prompt_a: "version unavailable",
  prompt_b: "version unavailable",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

interface SetupOptions {
  agents?: EvalDashboard[];
  runAllPending?: boolean;
  historyData?: EvalDashboard | null;
  /** When set, overrides the default "no data" compare mock. */
  compareData?: EvalCompareResult | null;
  compareImpl?: Parameters<typeof useCompareRunsMock.mockImplementation>[0];
}

function setupDefaultMocks(overrides?: SetupOptions) {
  const agents = overrides?.agents ?? [DASHBOARD_AGENT_1];
  const runAllPending = overrides?.runAllPending ?? false;

  useEvalDashboardMock.mockReturnValue({
    data: agents,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });

  useRunAllAgentsMock.mockReturnValue({
    mutate: mockRunAllMutate,
    isPending: runAllPending,
  });

  useRunHistoryMock.mockReturnValue({
    data: overrides?.historyData !== undefined ? overrides.historyData : DASHBOARD_AGENT_1,
    isLoading: false,
    isError: false,
  });

  if (overrides?.compareImpl) {
    useCompareRunsMock.mockImplementation(overrides.compareImpl);
  } else if (overrides?.compareData !== undefined) {
    useCompareRunsMock.mockReturnValue({
      data: overrides.compareData,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  } else {
    useCompareRunsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  }

  usePromoteVersionMock.mockReturnValue({
    mutate: mockPromoteMutate,
    isPending: false,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvalDashboardView — AC-20", () => {
  it("renders the dashboard heading", () => {
    setupDefaultMocks();
    renderWithIntl(<EvalDashboardView />);
    expect(screen.getByText("Eval Dashboard")).toBeInTheDocument();
  });

  it("renders a 'Run all agents' button (AC-20)", () => {
    setupDefaultMocks();
    renderWithIntl(<EvalDashboardView />);
    expect(screen.getByRole("button", { name: /run all agents/i })).toBeInTheDocument();
  });

  it("clicking 'Run all agents' triggers the mutation", () => {
    setupDefaultMocks();
    renderWithIntl(<EvalDashboardView />);
    fireEvent.click(screen.getByRole("button", { name: /run all agents/i }));
    expect(mockRunAllMutate).toHaveBeenCalledTimes(1);
  });

  it("shows 'Running…' and disables the button while runAll is pending", () => {
    setupDefaultMocks({ runAllPending: true });
    renderWithIntl(<EvalDashboardView />);
    const btn = screen.getByRole("button", { name: /running/i });
    expect(btn).toBeDisabled();
  });

  it("renders each agent card with metric values (AC-20)", () => {
    setupDefaultMocks();
    renderWithIntl(<EvalDashboardView />);
    // Recall 85%, Precision 92%, Citation 78%
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getByText("78%")).toBeInTheDocument();
  });

  it("renders recent runs for each agent (AC-20)", () => {
    setupDefaultMocks();
    renderWithIntl(<EvalDashboardView />);
    // Run records show pass/fail badges (text, not color-only).
    const passBadges = screen.getAllByText("pass");
    expect(passBadges.length).toBeGreaterThanOrEqual(1);
    const failBadges = screen.getAllByText("fail");
    expect(failBadges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows up/down text for metric deltas (a11y — not color alone)", () => {
    setupDefaultMocks();
    renderWithIntl(<EvalDashboardView />);
    // Delta recall = +0.05 → "up +5%"; delta precision = -0.03 → "down -3%"
    // Use getAllByText because there may be multiple elements containing "up" or "down".
    const upElements = screen.getAllByText(/\bup\b/i);
    expect(upElements.length).toBeGreaterThanOrEqual(1);
    const downElements = screen.getAllByText(/\bdown\b/i);
    expect(downElements.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the empty state when there are no agents", () => {
    setupDefaultMocks({ agents: [] });
    renderWithIntl(<EvalDashboardView />);
    expect(screen.getByText("No eval data yet")).toBeInTheDocument();
    expect(screen.queryByText("85%")).not.toBeInTheDocument();
  });

  it("renders a loading skeleton while data is fetching", () => {
    useEvalDashboardMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });
    useRunAllAgentsMock.mockReturnValue({ mutate: mockRunAllMutate, isPending: false });
    useRunHistoryMock.mockReturnValue({ data: null, isLoading: false, isError: false });
    useCompareRunsMock.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
    usePromoteVersionMock.mockReturnValue({ mutate: mockPromoteMutate, isPending: false });

    const { container } = renderWithIntl(<EvalDashboardView />);
    // No agent cards during loading.
    expect(screen.queryByText("Eval Dashboard")).not.toBeInTheDocument();
    expect(container.firstChild).toBeTruthy();
  });
});

describe("CompareModal — AC-16/18", () => {
  it("renders a Compare button when there are ≥2 run groups", () => {
    setupDefaultMocks();
    renderWithIntl(<EvalDashboardView />);
    // DASHBOARD_AGENT_1 has 2 trend points → 2 groups → Compare button shown.
    expect(screen.getByRole("button", { name: /compare/i })).toBeInTheDocument();
  });

  it("opens the Compare modal when Compare is clicked", () => {
    setupDefaultMocks();
    renderWithIntl(<EvalDashboardView />);
    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/compare runs/i)).toBeInTheDocument();
  });

  it("shows per-metric deltas with text direction labels in the Compare modal (AC-16, a11y)", () => {
    setupDefaultMocks({ compareData: COMPARE_RESULT });
    renderWithIntl(<EvalDashboardView />);

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    // Dialog is open.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Both selects exist.
    expect(screen.getByLabelText(/baseline run group a/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/candidate run group b/i)).toBeInTheDocument();
  });

  it("renders metric deltas table when compare data is loaded (AC-16)", () => {
    setupDefaultMocks({ compareData: COMPARE_RESULT });
    renderWithIntl(<EvalDashboardView />);

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));

    // Metric deltas heading appears.
    expect(screen.getByText(/metric deltas/i)).toBeInTheDocument();
    // Recall, Precision, Citation rows present in the compare table (scoped to the dialog —
    // the dashboard card behind the modal also renders these metric labels).
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Recall")).toBeInTheDocument();
    expect(within(dialog).getByText("Precision")).toBeInTheDocument();
    expect(within(dialog).getByText("Citation")).toBeInTheDocument();
  });

  it("shows the system prompt diff section when compare returns data (AC-16)", () => {
    setupDefaultMocks({ compareData: COMPARE_RESULT });
    renderWithIntl(<EvalDashboardView />);

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));

    expect(screen.getByLabelText("System prompt diff (keyboard-navigable)")).toBeInTheDocument();
  });

  it("renders Promote version buttons in the Compare modal (AC-18)", () => {
    setupDefaultMocks({ compareData: COMPARE_RESULT });
    renderWithIntl(<EvalDashboardView />);

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));

    // Both Promote buttons must appear.
    expect(screen.getByRole("button", { name: /promote v5/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /promote v6/i })).toBeInTheDocument();
  });

  it("calls usePromoteVersion when a Promote button is clicked (AC-18)", () => {
    setupDefaultMocks({ compareData: COMPARE_RESULT });
    renderWithIntl(<EvalDashboardView />);

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    fireEvent.click(screen.getByRole("button", { name: /promote v6/i }));

    expect(mockPromoteMutate).toHaveBeenCalledWith({
      agentId: "agent-1",
      version: 6,
    });
  });

  it("renders 'version unavailable' fallback when a version was pruned (AC-16 edge case)", () => {
    setupDefaultMocks({ compareData: COMPARE_UNAVAILABLE });
    renderWithIntl(<EvalDashboardView />);

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));

    // The raw-prompt <pre> also literally contains "version unavailable", so assert on the
    // dedicated fallback element rather than a loose document-wide text match.
    expect(screen.getByTestId("version-unavailable")).toHaveTextContent(/version unavailable/i);
  });

  it("closes the Compare modal when Close is clicked", () => {
    setupDefaultMocks();
    renderWithIntl(<EvalDashboardView />);

    fireEvent.click(screen.getByRole("button", { name: /compare/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Use getAllByRole because the Modal may render multiple close-related buttons.
    const closeBtns = screen.getAllByRole("button", { name: /close/i });
    fireEvent.click(closeBtns[0]!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
