import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/eval.json";

const DASH = {
  owner_kind: null,
  owner_id: null,
  cases_total: 2,
  current: { recall: 0.9, precision: 0.8, citation_accuracy: 0.7, traces_passed: 1, traces_total: 2, cost_usd: 0.1 },
  delta: { recall: 0, precision: 0, citation_accuracy: 0 },
  trend: [],
  recent_runs: [
    {
      id: "r1", case_id: "c1", case_name: "case-a", ran_at: "2026-06-01T12:00:00Z",
      actual_output: null, pass: true, recall: 0.9, precision: 0.8, citation_accuracy: 0.7,
      duration_ms: 1200, cost_usd: 0.05,
    },
  ],
  alert: null,
};

vi.mock("../../../../lib/hooks/eval", () => ({
  useEvalDashboard: () => ({ data: DASH, isLoading: false }),
  useEvalCases: () => ({ data: [], isLoading: false }),
  useRunAllEvals: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { EvalDashboard } from "./EvalDashboard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("EvalDashboard (smoke)", () => {
  it("renders the default title + recent runs", () => {
    renderWithIntl(<EvalDashboard />);
    expect(screen.getByText("Eval Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Recent runs")).toBeInTheDocument();
    expect(screen.getByText("pass")).toBeInTheDocument();
  });
});
