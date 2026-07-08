import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRecentBatchRow } from "@devdigest/shared";
import evalsMessages from "../../../../../messages/en/evals.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { RecentRunsFeed } from "./RecentRunsFeed";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evals: evalsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeRow(overrides: Partial<EvalRecentBatchRow> = {}): EvalRecentBatchRow {
  return {
    batch: {
      id: "b1",
      agent_id: "ag1",
      kind: "full",
      status: "clean",
      agent_snapshot: {},
      recall: 0.9,
      precision: 0.85,
      citation_accuracy: 0.95,
      cost_usd: 0.02,
      ran_at: "2026-07-06T00:00:00.000Z",
      system_prompt_snapshot: null,
    },
    agent_id: "ag1",
    agent_name: "Security Reviewer",
    version: 3,
    pass_count: 4,
    total_count: 5,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("RecentRunsFeed", () => {
  it("renders the empty message when there are no rows", () => {
    renderWithIntl(<RecentRunsFeed rows={[]} />);
    expect(screen.getByText("No batches have run yet.")).toBeInTheDocument();
  });

  it("renders a row per agent and clicking a row navigates with ?batch= (AC-10)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RecentRunsFeed rows={[makeRow()]} />);

    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("4/5")).toBeInTheDocument(); // pass/total

    await user.click(screen.getByTestId("recent-run-row-b1"));
    expect(push).toHaveBeenCalledWith("/evals/ag1?batch=b1");
  });
});
