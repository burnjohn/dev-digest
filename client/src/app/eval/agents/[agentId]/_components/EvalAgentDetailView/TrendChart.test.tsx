import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalTrendPoint } from "@devdigest/shared/contracts/eval-ci";
import messages from "../../../../../../../messages/en/eval.json";
import { TrendChart } from "./TrendChart";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function point(overrides: Partial<EvalTrendPoint> = {}): EvalTrendPoint {
  return {
    run_id: "run-1",
    ran_at: "2026-01-01T00:00:00.000Z",
    agent_version: 3,
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    pass_rate: 0.85,
    cost_usd: 0.12,
    ...overrides,
  };
}

describe("TrendChart", () => {
  it("renders nothing with fewer than 2 points (AC-44 needs a real trend)", () => {
    const { container } = renderWithIntl(<TrendChart trend={[point()]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the accessible fallback table with each point's metrics, given version/cost data (AC-55)", () => {
    const trend = [
      point({ run_id: "run-1", ran_at: "2026-01-01T00:00:00.000Z", agent_version: 3, cost_usd: 0.12 }),
      point({ run_id: "run-2", ran_at: "2026-01-02T00:00:00.000Z", agent_version: 4, cost_usd: 0.15 }),
    ];
    renderWithIntl(<TrendChart trend={trend} />);
    expect(screen.getByText("2026-01-01T00:00:00.000Z")).toBeInTheDocument();
    expect(screen.getByText("2026-01-02T00:00:00.000Z")).toBeInTheDocument();
    expect(screen.getAllByText("80%")).not.toHaveLength(0);
  });
});
