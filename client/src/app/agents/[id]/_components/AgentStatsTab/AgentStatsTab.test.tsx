import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/runs.json";

vi.mock("../../../../../lib/hooks/stats", () => ({
  useAgentStats: () => ({
    data: {
      agent_id: "ag1",
      agent_name: "Security",
      runs: 3,
      findings_total: 10,
      accepted: 6,
      dismissed: 2,
      pending: 2,
      accept_rate: 0.75,
      dismiss_rate: 0.25,
      avg_findings_per_run: 3.3,
      total_cost_usd: 0.18,
      avg_cost_usd: 0.06,
      avg_latency_ms: 8200,
      findings_by_severity: { CRITICAL: 3, WARNING: 5, SUGGESTION: 2 },
      trend: [
        { label: "run 1", value: 2 },
        { label: "run 2", value: 4 },
        { label: "run 3", value: 4 },
      ],
    },
    isLoading: false,
  }),
}));

import AgentStatsTab from "./AgentStatsTab";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Per-agent Stats tab (smoke)", () => {
  it("renders accept-rate headline + outcomes", () => {
    renderWithIntl(<AgentStatsTab agentId="ag1" />);
    expect(screen.getByText("ACCEPT RATE")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("Findings by severity")).toBeInTheDocument();
  });
});
