import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatch, EvalBatchDetail, EvalBatchCompareResult } from "@devdigest/shared";
import agentsMessages from "../../../../messages/en/agents.json";

// ---- Mocks -----------------------------------------------------------------
// Focused unit suite for BatchHistoryTable — mocks its two data hooks and the
// CompareModal it conditionally renders, so this test never depends on the
// consumer suites (EvalsTab.test.tsx / EvalDetailView.test.tsx) to exercise
// its own contract (inline vs. modal compare, preselectBatchId).

let batchDetail: EvalBatchDetail | undefined;
let compareResult: EvalBatchCompareResult | undefined;

vi.mock("@/lib/hooks/eval", () => ({
  useEvalBatchDetail: () => ({ data: batchDetail, isLoading: false }),
  useEvalCompare: () => ({ data: compareResult, isLoading: false }),
}));

const compareModalSpy = vi.fn();
vi.mock("../CompareModal/CompareModal", () => ({
  CompareModal: (props: unknown) => {
    compareModalSpy(props);
    return <div data-testid="compare-modal-stub" />;
  },
}));

import { BatchHistoryTable } from "./BatchHistoryTable";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeBatch(overrides: Partial<EvalBatch> = {}): EvalBatch {
  return {
    id: "b1",
    agent_id: "ag1",
    kind: "full",
    status: "clean",
    agent_snapshot: { fingerprint: "abc123def456", display: { model: "gpt-4.1" } },
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    cost_usd: 0.01,
    ran_at: "2026-07-01T00:00:00.000Z",
    system_prompt_snapshot: null,
    ...overrides,
  };
}

const compareResultFixture: EvalBatchCompareResult = {
  a: { ...makeBatch({ id: "b1" }), cases: [], excluded_skill_owned_count: 0 },
  b: { ...makeBatch({ id: "b2", recall: 0.8, precision: 0.9, citation_accuracy: 0.95 }), cases: [], excluded_skill_owned_count: 0 },
  deltas: { recall: -0.2, precision: -0.1, citation_accuracy: -0.05, cost_usd: null },
  prompt_diff_available: false,
};

afterEach(() => {
  cleanup();
  batchDetail = undefined;
  compareResult = undefined;
  compareModalSpy.mockClear();
});

describe("BatchHistoryTable", () => {
  it("renders one row per batch and toggles the drill-down on click (expand/collapse)", async () => {
    const batches = [
      makeBatch({ id: "b1", ran_at: "2026-07-01T00:00:00.000Z" }),
      makeBatch({ id: "b2", ran_at: "2026-07-02T00:00:00.000Z" }),
    ];
    batchDetail = {
      ...batches[0]!,
      cases: [
        { case_id: "c1", case_name: "Case 1", status: "passed", expected_count: 1, matched_count: 1, findings_count: 1, cost_usd: 0.01 },
      ],
      excluded_skill_owned_count: 0,
    };
    const user = userEvent.setup();
    renderWithIntl(<BatchHistoryTable agentId="ag1" batches={batches} />);

    const row1Timestamp = screen.getByText(new Date("2026-07-01T00:00:00.000Z").toLocaleString());
    const row2Timestamp = screen.getByText(new Date("2026-07-02T00:00:00.000Z").toLocaleString());
    expect(row1Timestamp).toBeInTheDocument();
    expect(row2Timestamp).toBeInTheDocument();

    // Collapsed by default — drilldown header not present.
    expect(screen.queryByText("Case")).not.toBeInTheDocument();

    await user.click(row1Timestamp);
    expect(screen.getByText("Case")).toBeInTheDocument();
    expect(screen.getByText("Case 1")).toBeInTheDocument();

    // Clicking the same row again collapses it.
    await user.click(row1Timestamp);
    expect(screen.queryByText("Case")).not.toBeInTheDocument();
  });

  it("renders the empty state when there are no batches", () => {
    renderWithIntl(<BatchHistoryTable agentId="ag1" batches={[]} />);
    expect(screen.getByText("No batches run yet.")).toBeInTheDocument();
  });

  it("inline path (useModalCompare unset): selecting two rows renders BatchCompare inline, not a Compare button", async () => {
    const batches = [
      makeBatch({ id: "b1", ran_at: "2026-07-01T00:00:00.000Z" }),
      makeBatch({ id: "b2", ran_at: "2026-07-02T00:00:00.000Z", recall: 0.8, precision: 0.9, citation_accuracy: 0.95 }),
    ];
    compareResult = compareResultFixture;
    const user = userEvent.setup();
    renderWithIntl(<BatchHistoryTable agentId="ag1" batches={batches} />);

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);

    const panel = screen.getByTestId("batch-compare-panel");
    expect(panel).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compare" })).not.toBeInTheDocument();
    expect(compareModalSpy).not.toHaveBeenCalled();
  });

  it("modal path (useModalCompare=true): the always-visible Compare button is disabled until two rows are selected, then opens CompareModal", async () => {
    const batches = [
      makeBatch({ id: "b1", ran_at: "2026-07-01T00:00:00.000Z" }),
      makeBatch({ id: "b2", ran_at: "2026-07-02T00:00:00.000Z", recall: 0.8, precision: 0.9, citation_accuracy: 0.95 }),
    ];
    compareResult = compareResultFixture;
    const user = userEvent.setup();
    renderWithIntl(<BatchHistoryTable agentId="ag1" batches={batches} useModalCompare />);

    // Always visible in the header, but disabled with fewer than two selected.
    const compareButton = screen.getByRole("button", { name: "Compare" });
    expect(compareButton).toBeInTheDocument();
    expect(compareButton).toBeDisabled();

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);

    // Inline compare panel must NOT render in modal mode.
    expect(screen.queryByTestId("batch-compare-panel")).not.toBeInTheDocument();
    expect(compareButton).toBeEnabled();
    expect(compareModalSpy).not.toHaveBeenCalled();

    await user.click(compareButton);

    expect(screen.getByTestId("compare-modal-stub")).toBeInTheDocument();
    expect(compareModalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "ag1", batchIdA: "b1", batchIdB: "b2", batches }),
    );
  });

  it("preselectBatchId seeds expandedId so that row starts expanded on mount", () => {
    const batches = [
      makeBatch({ id: "b1", ran_at: "2026-07-01T00:00:00.000Z" }),
      makeBatch({ id: "b2", ran_at: "2026-07-02T00:00:00.000Z" }),
    ];
    batchDetail = {
      ...batches[1]!,
      cases: [
        { case_id: "c2", case_name: "Case 2", status: "passed", expected_count: 1, matched_count: 1, findings_count: 1, cost_usd: 0.01 },
      ],
      excluded_skill_owned_count: 0,
    };
    renderWithIntl(<BatchHistoryTable agentId="ag1" batches={batches} preselectBatchId="b2" />);

    // The drilldown table (case/outcome headers) only renders for the
    // expanded row — presence with no click confirms pre-expansion on mount.
    expect(screen.getByText("Case")).toBeInTheDocument();
    expect(screen.getByText("Case 2")).toBeInTheDocument();
  });

  it("omitting preselectBatchId starts fully collapsed (default, backward-compatible)", () => {
    const batches = [makeBatch({ id: "b1" })];
    renderWithIntl(<BatchHistoryTable agentId="ag1" batches={batches} />);
    expect(screen.queryByText("Case")).not.toBeInTheDocument();
  });
});
