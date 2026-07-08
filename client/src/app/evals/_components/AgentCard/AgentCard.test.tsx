import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { EvalAgentSummary } from "@devdigest/shared";
import evalsMessages from "../../../../../messages/en/evals.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { AgentCard } from "./AgentCard";

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
  push.mockClear();
});

describe("AgentCard", () => {
  it("renders agent name/model, latest-batch metrics, and last-run meta", () => {
    renderWithIntl(<AgentCard summary={makeSummary()} />);

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument(); // recall
    expect(screen.getByText("85%")).toBeInTheDocument(); // precision
    expect(screen.getByText("95%")).toBeInTheDocument(); // citation accuracy
    // No passInfo passed → the meta line falls back to the case count.
    expect(screen.getByText(/case\(s\)/)).toBeInTheDocument();
  });

  it("renders the pass/total meta line when passInfo is provided (AC-4)", () => {
    renderWithIntl(<AgentCard summary={makeSummary()} passInfo={{ pass: 17, total: 20 }} />);
    expect(screen.getByText(/17\/20 pass/)).toBeInTheDocument();
  });

  it("renders degraded styling when latest_batch.status is 'degraded' (AC-6)", () => {
    renderWithIntl(<AgentCard summary={makeSummary({ latest_batch: { ...makeSummary().latest_batch!, status: "degraded" } })} />);

    const statusText = screen.getByText("Degraded");
    expect(statusText).toBeInTheDocument();
    expect(statusText).toHaveStyle({ color: "var(--crit)" });
  });

  it("clicking the card navigates to the agent's detail page (AC-7)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AgentCard summary={makeSummary()} />);

    await user.click(screen.getByTestId("agent-card-ag1"));
    expect(push).toHaveBeenCalledWith("/evals/ag1");
  });
});
