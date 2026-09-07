import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard } from "@devdigest/shared/contracts/eval-ci";
import evalMessages from "../../../../../messages/en/eval.json";
import shellMessages from "../../../../../messages/en/shell.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/eval",
}));

let DASHBOARD: EvalDashboard = { agents: [], recent_runs: [], skills: [] };
const runAllMutate = vi.fn();
const runAllSkillsMutate = vi.fn();

vi.mock("@/lib/hooks/eval", () => ({
  useEvalDashboard: () => ({ data: DASHBOARD, isLoading: false, isError: false, refetch: vi.fn() }),
  useRunAllEvals: () => ({ mutate: runAllMutate, isPending: false, data: undefined }),
  // specs/15-skill-eval-cases.md — RunAllModal now calls a SECOND mutation
  // hook unconditionally (client/LEARNINGS.md 2026-08-03: a component
  // calling two mutation hooks breaks a test that only mocked one).
  useRunAllSkillEvals: () => ({ mutate: runAllSkillsMutate, isPending: false, data: undefined }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboardView", () => {
  it("shows the empty state when no agent has eval cases", () => {
    DASHBOARD = { agents: [], recent_runs: [], skills: [] };
    renderWithIntl(<EvalDashboardView />);
    expect(screen.getByRole("heading", { name: evalMessages.dashboard.defaultTitle })).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.perAgentNote)).toBeInTheDocument();
  });

  it("lists every agent with cases and its latest metrics (AC-40)", () => {
    DASHBOARD = {
      agents: [
        {
          agent_id: "agent-1",
          agent_name: "Security Reviewer",
          cases_total: 8,
          latest: {
            id: "run-1",
            owner_kind: "agent",
            owner_id: "agent-1",
            agent_name: "Security Reviewer",
            status: "completed",
            started_at: "2026-01-01T00:00:00.000Z",
            finished_at: "2026-01-01T00:01:00.000Z",
            agent_version: 1,
            case_ids: ["c1"],
            metrics: {
              recall: 0.8,
              precision: 0.9,
              citation_accuracy: 1,
              traces_passed: 6,
              traces_total: 8,
              cases_errored: 0,
              duration_ms: 1000,
              cost_usd: 0.05,
              per_case: [],
            },
            duration_ms: 1000,
            cost_usd: 0.05,
            error_reason: null,
          },
          trend: [],
        },
      ],
      recent_runs: [],
      skills: [],
    };
    renderWithIntl(<EvalDashboardView />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("6/8")).toBeInTheDocument();
  });

  it("opens the run-all confirmation dialog stating the total execution count (AC-25)", () => {
    DASHBOARD = {
      agents: [
        { agent_id: "a1", agent_name: "Agent One", cases_total: 3, latest: null, trend: [] },
        { agent_id: "a2", agent_name: "Agent Two", cases_total: 5, latest: null, trend: [] },
      ],
      recent_runs: [],
      skills: [],
    };
    renderWithIntl(<EvalDashboardView />);
    fireEvent.click(screen.getByRole("button", { name: evalMessages.run.confirmAll.trigger }));
    expect(screen.getByText(evalMessages.run.confirmAll.title)).toBeInTheDocument();
    expect(screen.getByText(/8 case executions/)).toBeInTheDocument();
  });

  it("lists skills in a distinct section from the agent list, stating their numbers are not a ranking (AC-39, AC-40)", () => {
    DASHBOARD = {
      agents: [],
      recent_runs: [],
      skills: [
        {
          skill_id: "skill-1",
          skill_name: "secret-leakage-gate",
          cases_total: 4,
          carrier_agent_name: "Security Reviewer",
          latest: null,
          tokens_per_run: 120,
        },
      ],
    };
    renderWithIntl(<EvalDashboardView />);
    expect(screen.getByText(evalMessages.skill.summary.heading)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.skill.summary.caption)).toBeInTheDocument();
    expect(screen.getByText("secret-leakage-gate")).toBeInTheDocument();
  });

  it("states an all-zero lift as a sentence, never a bare zero (AC-41)", () => {
    DASHBOARD = {
      agents: [],
      recent_runs: [],
      skills: [
        {
          skill_id: "skill-1",
          skill_name: "secret-leakage-gate",
          cases_total: 4,
          carrier_agent_name: "Security Reviewer",
          latest: {
            id: "run-1",
            owner_kind: "skill",
            owner_id: "skill-1",
            agent_name: null,
            status: "completed",
            started_at: "2026-01-01T00:00:00.000Z",
            finished_at: "2026-01-01T00:01:00.000Z",
            agent_version: 1,
            case_ids: ["c1"],
            metrics: {
              recall: 1,
              precision: 1,
              citation_accuracy: 1,
              traces_passed: 4,
              traces_total: 4,
              cases_errored: 0,
              duration_ms: 1000,
              cost_usd: 0.02,
              per_case: [],
            },
            duration_ms: 2000,
            cost_usd: 0.04,
            error_reason: null,
            skill_version: 1,
            carrier_agent_id: "agent-1",
            carrier_agent_name: "Security Reviewer",
            gates_bypassed: false,
            arm_without: null,
            lift: { recall: 0, precision: 0, citation_accuracy: 0 },
            effects: [],
            effect_counts: { helped: 0, hurt: 0, no_effect_pass: 4, no_effect_fail: 0 },
          },
          tokens_per_run: 120,
        },
      ],
    };
    renderWithIntl(<EvalDashboardView />);
    expect(screen.getByText(evalMessages.skill.lift.allZero)).toBeInTheDocument();
  });
});
