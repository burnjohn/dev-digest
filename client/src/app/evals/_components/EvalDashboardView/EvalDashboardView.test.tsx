import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalOwnerDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import commonMessages from "../../../../../messages/en/common.json";
import skillsMessages from "../../../../../messages/en/skills.json";
import agentsMessages from "../../../../../messages/en/agents.json";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let dashState: { data?: EvalOwnerDashboard[]; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
};
let agentsState: { data?: Agent[]; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
};

/* Typed param, not `async () => ...`: with no declared argument the mock's
   `mock.calls` is `[][]`, and asserting on `calls[n][0]` fails typecheck
   while the test itself still passes. */
const startBatch = vi.fn(async (_input: { owner_kind: string; owner_id: string }) => ({
  batch_id: "b-new",
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: () => ({ ...dashState, refetch: vi.fn() }),
  // `Run all agents` calls this. Mocking the module boundary means no real
  // `useMutation` runs, so these suites still need no QueryClientProvider.
  useStartEvalBatch: () => ({ mutateAsync: startBatch }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ ...agentsState, refetch: vi.fn() }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

function agent(id: string, name: string, over: Partial<Agent> = {}): Agent {
  return {
    id,
    name,
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "x",
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skill_count: 0,
    ...over,
  };
}

function batch(over: Partial<NonNullable<EvalOwnerDashboard["latest_batch"]>> = {}) {
  return {
    id: "batch-1",
    owner_kind: "agent" as const,
    owner_id: "a1",
    owner_version: 7,
    runner_agent_id: null,
    runner_agent_version: null,
    started_at: "2026-05-29T09:14:00.000Z",
    finished_at: "2026-05-29T09:15:00.000Z",
    status: "succeeded" as const,
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    cases_passed: 17,
    cases_total: 20,
    cost_usd: 0.23,
    ...over,
  };
}

function dashboardRow(over: Partial<EvalOwnerDashboard> = {}): EvalOwnerDashboard {
  return {
    owner_kind: "agent",
    owner_id: "a1",
    cases_total: 20,
    latest_batch: batch(),
    delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
    trend: [],
    recent_batches: [],
    alert: null,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  push.mockClear();
  startBatch.mockClear();
  dashState = { data: [], isLoading: false, isError: false };
  agentsState = { data: [], isLoading: false, isError: false };
});

function renderView() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        eval: evalMessages,
        common: commonMessages,
        skills: skillsMessages,
        agents: agentsMessages,
      }}
    >
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboardView", () => {
  it("renders one row per enabled agent with model, latest batch version/pass and the three metrics", () => {
    dashState = { data: [dashboardRow()], isLoading: false, isError: false };
    agentsState = { data: [agent("a1", "Security Reviewer")], isLoading: false, isError: false };
    renderView();

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("openai/gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.getByText(/17\/20/)).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Security Reviewer/ })).toHaveAttribute(
      "href",
      "/evals/a1",
    );
  });

  it("renders the page subtitle", () => {
    dashState = { data: [dashboardRow()], isLoading: false, isError: false };
    agentsState = { data: [agent("a1", "Security Reviewer")], isLoading: false, isError: false };
    renderView();

    expect(screen.getByText(evalMessages.dashboard.subtitle)).toBeInTheDocument();
  });

  it("does not render a disabled agent's row even if the dashboard endpoint served one", () => {
    dashState = {
      data: [dashboardRow({ owner_id: "a2" })],
      isLoading: false,
      isError: false,
    };
    // a2 absent from useAgents() — mirrors a disabled/removed agent, since the
    // dashboard endpoint is the one contract for REQ-29's "enabled only".
    agentsState = { data: [agent("a1", "Other Agent")], isLoading: false, isError: false };
    renderView();

    expect(screen.queryByText("Other Agent")).not.toBeInTheDocument();
    expect(screen.getByText(/No agents yet/)).toBeInTheDocument();
  });

  it("renders an empty state naming the Agents page when there are zero agents, not an empty table", () => {
    dashState = { data: [], isLoading: false, isError: false };
    agentsState = { data: [], isLoading: false, isError: false };
    renderView();

    expect(screen.getByText(/No agents yet/)).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: "Agents" });
    cta.click();
    expect(push).toHaveBeenCalledWith("/agents");
  });

  it("shows a no-runs marker instead of metrics when an agent has no latest batch", () => {
    dashState = {
      data: [dashboardRow({ latest_batch: null })],
      isLoading: false,
      isError: false,
    };
    agentsState = { data: [agent("a1", "Security Reviewer")], isLoading: false, isError: false };
    renderView();

    expect(screen.getAllByText(evalMessages.dashboard.noRuns).length).toBeGreaterThan(0);
    expect(screen.queryByText("82%")).not.toBeInTheDocument();
  });

  describe("Run all agents", () => {
    // Matched by PREFIX, not exact name: the disabled state appends its reason
    // to `aria-label`, which renames the button (client/INSIGHTS.md 2026-08-29).
    const findRunAll = () => screen.getByRole("button", { name: /^Run all agents/ });

    it("starts one batch per agent row, and only for agents that actually rendered", async () => {
      dashState = {
        data: [dashboardRow(), dashboardRow({ owner_id: "a2" }), dashboardRow({ owner_id: "gone" })],
        isLoading: false,
        isError: false,
      };
      agentsState = {
        data: [agent("a1", "Security Reviewer"), agent("a2", "Perf Reviewer")],
        isLoading: false,
        isError: false,
      };
      renderView();

      fireEvent.click(findRunAll());

      await waitFor(() => expect(startBatch).toHaveBeenCalledTimes(2));
      expect(startBatch.mock.calls.map((c) => c[0])).toEqual([
        { owner_kind: "agent", owner_id: "a1" },
        { owner_kind: "agent", owner_id: "a2" },
      ]);
    });

    it("keeps sweeping after one agent rejects, instead of aborting on the first", async () => {
      // `POST /evals/batches` 400s for an agent with no eval cases. An
      // uncaught rejection stopped the loop at agent one and silently skipped
      // the rest — observed in the browser, where the FIRST row is exactly
      // such an agent.
      startBatch.mockRejectedValueOnce(new Error("This owner has no eval cases to run"));
      dashState = {
        data: [dashboardRow({ owner_id: "a1" }), dashboardRow({ owner_id: "a2" })],
        isLoading: false,
        isError: false,
      };
      agentsState = {
        data: [agent("a1", "No Cases Reviewer"), agent("a2", "Security Reviewer")],
        isLoading: false,
        isError: false,
      };
      renderView();

      fireEvent.click(findRunAll());

      await waitFor(() => expect(startBatch).toHaveBeenCalledTimes(2));
      expect(startBatch.mock.calls[1]![0]).toEqual({ owner_kind: "agent", owner_id: "a2" });
    });

    it("is disabled and announces why when there is no agent to run", () => {
      dashState = { data: [], isLoading: false, isError: false };
      agentsState = { data: [], isLoading: false, isError: false };
      renderView();

      const button = findRunAll();
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleName(
        `Run all agents — ${evalMessages.dashboard.noAgentsToRun}`,
      );

      fireEvent.click(button);
      expect(startBatch).not.toHaveBeenCalled();
    });
  });

  describe("recent runs across all agents", () => {
    it("lists every agent's batches newest-first, whichever agent they belong to", () => {
      dashState = {
        data: [
          dashboardRow({
            owner_id: "a1",
            recent_batches: [batch({ id: "b-old", started_at: "2026-05-20T08:00:00.000Z" })],
          }),
          dashboardRow({
            owner_id: "a2",
            recent_batches: [batch({ id: "b-new", started_at: "2026-05-29T08:00:00.000Z" })],
          }),
        ],
        isLoading: false,
        isError: false,
      };
      agentsState = {
        data: [agent("a1", "Security Reviewer"), agent("a2", "Perf Reviewer")],
        isLoading: false,
        isError: false,
      };
      const { container } = renderView();

      const names = Array.from(container.querySelectorAll("tbody tr td:first-child")).map(
        (td) => td.textContent,
      );
      expect(names).toEqual(["Perf Reviewer", "Security Reviewer"]);
    });

    it("never lists a batch belonging to an agent the list itself dropped", () => {
      dashState = {
        data: [
          dashboardRow({ owner_id: "a1", recent_batches: [batch({ id: "b-kept" })] }),
          dashboardRow({
            owner_id: "ghost",
            recent_batches: [batch({ id: "b-orphan", started_at: "2026-06-01T08:00:00.000Z" })],
          }),
        ],
        isLoading: false,
        isError: false,
      };
      agentsState = { data: [agent("a1", "Security Reviewer")], isLoading: false, isError: false };
      const { container } = renderView();

      const rows = container.querySelectorAll("tbody tr");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.textContent).toContain("Security Reviewer");
    });

    it("shows the no-runs copy when no agent has ever run", () => {
      dashState = { data: [dashboardRow({ recent_batches: [] })], isLoading: false, isError: false };
      agentsState = { data: [agent("a1", "Security Reviewer")], isLoading: false, isError: false };
      const { container } = renderView();

      expect(container.querySelector("tbody")).toBeNull();
      expect(screen.getByText(evalMessages.dashboard.noRuns)).toBeInTheDocument();
    });
  });
});
