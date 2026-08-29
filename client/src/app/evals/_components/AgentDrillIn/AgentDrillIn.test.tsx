import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalOwnerDashboard } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import commonMessages from "../../../../../messages/en/common.json";
import skillsMessages from "../../../../../messages/en/skills.json";
import runsMessages from "../../../../../messages/en/runs.json";
import agentsMessages from "../../../../../messages/en/agents.json";

// jsdom's `getBoundingClientRect()` always returns an all-zero rect, so
// Recharts' `ResponsiveContainer` (which TrendChart renders via LineChart)
// settles on 0x0 and emits no SVG at all — T3's LineChart.test.tsx stubs this
// for the same reason (client/INSIGHTS.md-equivalent note in T16's dispatch).
let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect;
beforeEach(() => {
  originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function stub(this: Element) {
    return {
      width: 400,
      height: 160,
      top: 0,
      left: 0,
      right: 400,
      bottom: 160,
      x: 0,
      y: 0,
      toJSON() {
        return this;
      },
    } as DOMRect;
  };
});
afterEach(() => {
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

let agentState: { data?: Agent; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: true,
  isError: false,
};
let dashState: { data?: EvalOwnerDashboard; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: true,
  isError: false,
};
let compareState: { data?: unknown; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: true,
  isError: false,
};

/* CompareModal is rendered from this tree, and it now carries a WRITE
   (`Promote vN`) — so its restore hooks, the owner queries behind its no-op
   check, and the toast it reports through all have to be stubbed here too.
   `useQueryClient` and `useToast` both throw before they look at anything else,
   so an unmocked one fails this suite in `render`, not in an assertion. */
vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => ({ ...agentState, refetch: vi.fn() }),
  useRestoreAgentVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkill: () => ({ data: undefined }),
  useRestoreSkillVersion: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/hooks/evals", () => ({
  useEvalOwnerDashboard: () => ({ ...dashState, refetch: vi.fn() }),
  useEvalBatchComparison: () => ({ ...compareState, refetch: vi.fn() }),
}));

import { AgentDrillIn } from "./AgentDrillIn";

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "Security Reviewer",
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "x",
    output_schema: null,
    enabled: true,
    version: 7,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skill_count: 0,
    ...over,
  };
}

function batch(id: string, over: Partial<NonNullable<EvalOwnerDashboard["latest_batch"]>> = {}) {
  return {
    id,
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

function dashboard(over: Partial<EvalOwnerDashboard> = {}): EvalOwnerDashboard {
  return {
    owner_kind: "agent",
    owner_id: "a1",
    cases_total: 20,
    latest_batch: batch("b7"),
    delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
    trend: [],
    recent_batches: [batch("b7"), batch("b6", { owner_version: 6, recall: 0.78 })],
    alert: null,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  agentState = { data: undefined, isLoading: true, isError: false };
  dashState = { data: undefined, isLoading: true, isError: false };
  compareState = { data: undefined, isLoading: true, isError: false };
});

function renderDrillIn() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        eval: evalMessages,
        common: commonMessages,
        skills: skillsMessages,
        runs: runsMessages,
        agents: agentsMessages,
      }}
    >
      <AgentDrillIn agentId="a1" />
    </NextIntlClientProvider>,
  );
}

describe("AgentDrillIn", () => {
  it("renders the alert banner verbatim only when the server emitted one", () => {
    agentState = { data: agent(), isLoading: false, isError: false };
    dashState = {
      data: dashboard({ alert: "Precision dipped 2pts on v7 — a new false positive slipped in." }),
      isLoading: false,
      isError: false,
    };
    renderDrillIn();

    expect(
      screen.getByText("Precision dipped 2pts on v7 — a new false positive slipped in."),
    ).toBeInTheDocument();
  });

  it("renders no banner when the server emitted none", () => {
    agentState = { data: agent(), isLoading: false, isError: false };
    dashState = { data: dashboard({ alert: null }), isLoading: false, isError: false };
    renderDrillIn();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders a metric with no preceding batch as an em dash, never a signed zero", () => {
    agentState = { data: agent(), isLoading: false, isError: false };
    dashState = {
      data: dashboard({ delta: { recall: null, precision: null, citation_accuracy: null } }),
      isLoading: false,
      isError: false,
    };
    renderDrillIn();

    // Three metric cards, each with a "—" delta.
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("+0%")).not.toBeInTheDocument();
  });

  it("enables Compare only once exactly two distinct rows are checked, and opens the modal", () => {
    agentState = { data: agent(), isLoading: false, isError: false };
    dashState = { data: dashboard(), isLoading: false, isError: false };
    compareState = {
      data: {
        older: batch("b6", { owner_version: 6 }),
        newer: batch("b7", { owner_version: 7 }),
        recall: { old: 0.78, new: 0.82, delta: 0.04 },
        precision: { old: 0.93, new: 0.91, delta: -0.02 },
        citation_accuracy: { old: 0.94, new: 0.95, delta: 0.01 },
        cost_usd: { old: 0.21, new: 0.23, delta: 0.02 },
        same_version: false,
        prompt_diff: [{ op: "same", text: "unchanged line" }],
      },
      isLoading: false,
      isError: false,
    };
    renderDrillIn();

    const compareButton = screen.getByRole("button", { name: "Compare" });
    expect(compareButton).toBeDisabled();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]!);
    expect(compareButton).toBeDisabled();
    fireEvent.click(checkboxes[1]!);
    expect(compareButton).not.toBeDisabled();

    fireEvent.click(compareButton);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("gives every row checkbox an accessible name", () => {
    agentState = { data: agent(), isLoading: false, isError: false };
    dashState = { data: dashboard(), isLoading: false, isError: false };
    renderDrillIn();

    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      expect(cb).toHaveAccessibleName();
    }
  });

  it("renders an explicit empty state on the trend chart when the window holds no terminal batch", () => {
    agentState = { data: agent(), isLoading: false, isError: false };
    dashState = { data: dashboard({ trend: [] }), isLoading: false, isError: false };
    renderDrillIn();

    expect(screen.getByText(commonMessages.states.empty)).toBeInTheDocument();
  });

  describe("run history columns", () => {
    it("puts the date and the version in SEPARATE cells", () => {
      // They used to share one cell as "<date> · v7"; the version is now its
      // own sortable-looking column, matching the cross-agent feed on /evals.
      agentState = { data: agent(), isLoading: false, isError: false };
      dashState = { data: dashboard(), isLoading: false, isError: false };
      const { container } = renderDrillIn();

      const cells = Array.from(container.querySelectorAll("tbody tr")[0]!.querySelectorAll("td"));
      expect(cells[1]!.textContent).toBe("2026-05-29 09:14");
      expect(cells[2]!.textContent).toBe("v7");
    });

    it("draws each metric as a bar in its own colour, and no fill for a null", () => {
      agentState = { data: agent(), isLoading: false, isError: false };
      dashState = {
        data: dashboard({
          recent_batches: [batch("b7", { citation_accuracy: null })],
        }),
        isLoading: false,
        isError: false,
      };
      const { container } = renderDrillIn();

      const cells = Array.from(container.querySelectorAll("tbody tr")[0]!.querySelectorAll("td"));
      const fillOf = (i: number) => cells[i]!.querySelector("span > span") as HTMLElement | null;

      expect(fillOf(3)!.style.background).toBe("var(--accent)");
      expect(fillOf(4)!.style.background).toBe("var(--ok)");
      // citation_accuracy is null here: an empty track, no fill, an em dash.
      expect(fillOf(5)).toBeNull();
      expect(cells[5]!.textContent).toBe("—");
    });

    it("colours each metric card's value and gives it a sparkline once the window has two points", () => {
      agentState = { data: agent(), isLoading: false, isError: false };
      dashState = {
        data: dashboard({
          trend: [
            { metric: "recall", batch_id: "b1", finished_at: "2026-05-01T00:00:00.000Z", value: 0.7 },
            { metric: "recall", batch_id: "b2", finished_at: "2026-05-05T00:00:00.000Z", value: 0.8 },
          ],
        }),
        isLoading: false,
        isError: false,
      };
      const { container } = renderDrillIn();

      const cards = Array.from(container.querySelectorAll("svg > path[stroke]"));
      // Recall has two points, so exactly one card draws a spark; precision
      // and citation have none in this window and must draw nothing.
      const sparks = cards.filter((p) => p.getAttribute("stroke") === "var(--accent)");
      expect(sparks.length).toBeGreaterThanOrEqual(1);
      expect(
        cards.filter((p) => p.getAttribute("stroke") === "var(--warn)"),
      ).toHaveLength(0);

      // Scoped to the CARD: "82%" also appears in the runs table's recall bar.
      const recallCard = screen.getByText("RECALL").closest("div")!.parentElement!;
      expect(within(recallCard).getByText("82%")).toHaveStyle({ color: "var(--accent)" });
    });
  });

  it("passes a null trend point through as a gap, never a plotted 0", () => {
    agentState = { data: agent(), isLoading: false, isError: false };
    dashState = {
      data: dashboard({
        trend: [
          { metric: "recall", batch_id: "b1", finished_at: "2026-05-01T00:00:00.000Z", value: 0.7 },
          { metric: "recall", batch_id: "b2", finished_at: "2026-05-05T00:00:00.000Z", value: null },
          { metric: "recall", batch_id: "b3", finished_at: "2026-05-10T00:00:00.000Z", value: 0.8 },
        ],
      }),
      isLoading: false,
      isError: false,
    };
    const { container } = renderDrillIn();

    const path = container.querySelector("path.recharts-line-curve");
    expect(path).not.toBeNull();
    const d = path!.getAttribute("d") ?? "";
    expect(d.match(/M/g)?.length ?? 0).toBeGreaterThan(1);
  });
});
