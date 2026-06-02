import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentPerf } from "@devdigest/shared";
import messages from "../../../../../messages/en/agentPerformance.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const PERF: AgentPerf = {
  summary: { runs: 5, total_cost_usd: 0.42, avg_accept_rate: 0.6, most_active_agent: "Security" },
  agents: [
    {
      agent_id: "a1", agent_name: "Security", provider: "openai", model: "gpt-4.1",
      runs: 3, findings_total: 9, accepted: 6, dismissed: 2,
      accept_rate: 0.75, dismiss_rate: 0.25, avg_findings_per_run: 3, total_cost_usd: 0.3,
      avg_cost_usd: 0.1, avg_latency_ms: 8000, last_run_at: null,
      findings_by_severity: { CRITICAL: 1, WARNING: 4, SUGGESTION: 4 }, trend: [2, 3, 4],
    },
    {
      agent_id: "a2", agent_name: "Style", provider: "anthropic", model: "claude-sonnet-4-6",
      runs: 2, findings_total: 4, accepted: 1, dismissed: 3,
      accept_rate: 0.25, dismiss_rate: 0.75, avg_findings_per_run: 2, total_cost_usd: 0.12,
      avg_cost_usd: 0.06, avg_latency_ms: 5000, last_run_at: null,
      findings_by_severity: { CRITICAL: 0, WARNING: 1, SUGGESTION: 3 }, trend: [1, 3],
    },
  ],
  cost_by_agent: [{ label: "Security", value: 0.3 }, { label: "Style", value: 0.12 }],
  cost_by_model: [{ label: "gpt-4.1", value: 0.3 }, { label: "claude-sonnet-4-6", value: 0.12 }],
};

vi.mock("../../../../lib/hooks/performance", () => ({
  useAgentPerformance: () => ({ data: PERF, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import { AgentPerformanceView } from "./AgentPerformanceView";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agentPerformance: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("AgentPerformanceView (smoke)", () => {
  it("renders translated title + agents sorted by accept-rate", () => {
    renderWithIntl(<AgentPerformanceView />);
    expect(screen.getByText("Agent Performance")).toBeInTheDocument();
    expect(screen.getAllByText("Security").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Style").length).toBeGreaterThan(0);
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });
});
