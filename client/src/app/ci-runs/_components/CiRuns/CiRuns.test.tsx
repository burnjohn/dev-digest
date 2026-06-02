import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/ci.json";

const RUNS = [
  {
    id: "run1", ci_installation_id: "i1", pr_number: 482, ran_at: "2026-06-01T12:00:00Z",
    status: "succeeded", findings_count: 3, cost_usd: 0.04,
    github_url: "https://github.com/acme/payments-api/actions/runs/1001",
    source: "github_actions", agent: "Security", duration_s: null,
  },
];

vi.mock("../../../../lib/hooks/ci", () => ({
  useCiRuns: () => ({ data: RUNS, isLoading: false }),
  useIngestCiRuns: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { CiRunsView } from "./CiRuns";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("CiRunsView (smoke)", () => {
  it("renders the title + a run row with status", () => {
    renderWithIntl(<CiRunsView />);
    expect(screen.getByText("CI Runs")).toBeInTheDocument();
    expect(screen.getByText("#482")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
  });
});
