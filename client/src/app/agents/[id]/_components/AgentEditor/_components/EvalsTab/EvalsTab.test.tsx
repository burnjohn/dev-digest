import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCaseListItem, EvalBatch, EvalTrendPointV2, EvalBatchDetail, EvalBatchCompareResult, EvalKpiDeltaResponse } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";

// ---- Mocks -----------------------------------------------------------------

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

let cases: EvalCaseListItem[] = [];
let excludedSkillOwnedCount = 0;
let batches: EvalBatch[] = [];
let trendPoints: EvalTrendPointV2[] = [];
let batchDetail: EvalBatchDetail | undefined;
let compareResult: EvalBatchCompareResult | undefined;
let kpiDelta: EvalKpiDeltaResponse | undefined = null;

const runBatchMutate = vi.fn();
let runBatchIsPending = false;
const deleteCaseMutate = vi.fn();
const createCaseMutate = vi.fn();
let createCaseIsPending = false;
const updateCaseMutate = vi.fn();
let updateCaseIsPending = false;
const clearHistoryMutate = vi.fn();
let clearHistoryIsPending = false;

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: { cases, excluded_skill_owned_count: excludedSkillOwnedCount }, isLoading: false }),
  useEvalBatchHistory: () => ({ data: batches, isLoading: false }),
  useEvalTrend: () => ({ data: trendPoints, isLoading: false }),
  useEvalKpiDelta: () => ({ data: kpiDelta, isLoading: false }),
  useEvalBatchDetail: () => ({ data: batchDetail, isLoading: false }),
  useEvalRunCompletion: () => ({ data: undefined, isLoading: false }),
  useEvalCompare: () => ({ data: compareResult, isLoading: false }),
  useRunEvalBatch: () => ({ mutate: runBatchMutate, isPending: runBatchIsPending }),
  useDeleteEvalCase: () => ({ mutate: deleteCaseMutate }),
  useCreateEvalCase: () => ({ mutate: createCaseMutate, isPending: createCaseIsPending }),
  useUpdateEvalCase: () => ({ mutate: updateCaseMutate, isPending: updateCaseIsPending }),
  useClearEvalHistory: () => ({ mutate: clearHistoryMutate, isPending: clearHistoryIsPending }),
}));

import { EvalsTab } from "./EvalsTab";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function makeCase(overrides: Partial<EvalCaseListItem> = {}): EvalCaseListItem {
  return {
    id: "case1",
    owner_id: "ag1",
    name: "Case 1",
    source: "manual",
    source_finding_id: null,
    source_pr_number: null,
    input_diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-x\n+y",
    expected_output: [{ type: "must_find", file: "a.ts", line_start: 1, line_end: 2 }],
    last_run_status: "never_run",
    last_run_summary: null,
    notes: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  routerPush.mockClear();
  cases = [];
  excludedSkillOwnedCount = 0;
  batches = [];
  trendPoints = [];
  batchDetail = undefined;
  compareResult = undefined;
  kpiDelta = null;
  runBatchMutate.mockClear();
  runBatchIsPending = false;
  deleteCaseMutate.mockClear();
  createCaseMutate.mockClear();
  createCaseIsPending = false;
  updateCaseMutate.mockClear();
  updateCaseIsPending = false;
  clearHistoryMutate.mockClear();
  clearHistoryIsPending = false;
});

describe("EvalsTab", () => {
  it("renders both CTAs in the empty state (zero cases)", () => {
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText("No eval cases yet")).toBeInTheDocument();
    expect(screen.getByText(/Add to evals/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New eval case" })).toBeInTheDocument();
  });

  it("renders all 5 status states in the case list", () => {
    cases = [
      makeCase({ id: "c1", name: "Never run case", last_run_status: "never_run" }),
      makeCase({ id: "c2", name: "Passed case", last_run_status: "passed" }),
      makeCase({ id: "c3", name: "Failed case", last_run_status: "failed" }),
      makeCase({ id: "c4", name: "Error case", last_run_status: "error" }),
      makeCase({ id: "c5", name: "Flaked case", last_run_status: "flaked" }),
    ];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getByTestId("eval-case-row-c1")).toBeInTheDocument();
    expect(screen.getByTestId("eval-case-row-c2")).toBeInTheDocument();
    expect(screen.getByTestId("eval-case-row-c3")).toBeInTheDocument();
    expect(screen.getByTestId("eval-case-row-c4")).toBeInTheDocument();
    expect(screen.getByTestId("eval-case-row-c5")).toBeInTheDocument();

    // Each row's status icon carries a distinct accessible label.
    expect(within(screen.getByTestId("eval-case-row-c1")).getByLabelText("Never run")).toBeInTheDocument();
    expect(within(screen.getByTestId("eval-case-row-c2")).getByLabelText("Passed")).toBeInTheDocument();
    expect(within(screen.getByTestId("eval-case-row-c3")).getByLabelText("Failed")).toBeInTheDocument();
    expect(within(screen.getByTestId("eval-case-row-c4")).getByLabelText("Error")).toBeInTheDocument();
    expect(within(screen.getByTestId("eval-case-row-c5")).getByLabelText("Flaked")).toBeInTheDocument();

    // No skill-owned cases excluded here — the note must not render (AC-2: never silently implied).
    expect(screen.queryByText(/skill-owned eval case\(s\) are not shown here/)).not.toBeInTheDocument();
  });

  it('"Run all evals" triggers the batch mutation with an empty body', async () => {
    cases = [makeCase()];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab agent={AGENT} />);
    await user.click(screen.getByRole("button", { name: "Run all evals" }));
    // #9 — the mutation is a 202 fire-and-poll: the body is still `{}` (full
    // set), but a second arg (onSuccess callback capturing `batch_id` for the
    // completion poll) is now also passed.
    expect(runBatchMutate).toHaveBeenCalledWith({}, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it("delete requires confirmation before the delete mutation fires", async () => {
    cases = [makeCase({ name: "Delete me" })];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab agent={AGENT} />);

    const row = screen.getByTestId("eval-case-row-case1");
    await user.click(within(row).getByRole("button", { name: "Delete" }));

    // Mutation must NOT fire yet — confirm modal must appear first.
    expect(deleteCaseMutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText('Delete "Delete me"? This cannot be undone.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(deleteCaseMutate).toHaveBeenCalledWith("case1");
  });

  it("shows the excluded skill-owned count note when > 0", () => {
    cases = [makeCase()];
    excludedSkillOwnedCount = 3;
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText(/3 skill-owned eval case\(s\) are not shown here/)).toBeInTheDocument();
  });

  it("trend chart renders a degraded point distinctly", () => {
    cases = [makeCase()];
    trendPoints = [
      { batch_id: "b1", ran_at: "2026-07-01T00:00:00.000Z", recall: 1, precision: 1, citation_accuracy: 1, is_degraded: false, agent_snapshot: { display: { model: "gpt-4.1" } }, cost_usd: 0.01 },
      { batch_id: "b2", ran_at: "2026-07-02T00:00:00.000Z", recall: 0.8, precision: 0.9, citation_accuracy: 0.95, is_degraded: true, agent_snapshot: { display: { model: "gpt-4.1" } }, cost_usd: 0.02 },
    ];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    // Degraded batches are flagged via the chart's degraded legend (AC-30);
    // per-point markers were removed in favour of linking to Batch History.
    expect(screen.getByText("Degraded batch")).toBeInTheDocument();
  });

  it("compare panel renders when two batch rows are selected", async () => {
    cases = [makeCase()];
    batches = [
      { id: "b1", agent_id: "ag1", kind: "full", status: "clean", agent_snapshot: { display: { model: "gpt-4.1" } }, recall: 1, precision: 1, citation_accuracy: 1, cost_usd: 0.01, ran_at: "2026-07-01T00:00:00.000Z", system_prompt_snapshot: null },
      { id: "b2", agent_id: "ag1", kind: "full", status: "degraded", agent_snapshot: { display: { model: "gpt-4.1" } }, recall: 0.8, precision: 0.9, citation_accuracy: 0.95, cost_usd: 0.02, ran_at: "2026-07-02T00:00:00.000Z", system_prompt_snapshot: null },
    ];
    compareResult = {
      a: { id: "b1", agent_id: "ag1", kind: "full", status: "clean", agent_snapshot: {}, recall: 1, precision: 1, citation_accuracy: 1, cost_usd: 0.01, ran_at: "2026-07-01T00:00:00.000Z", system_prompt_snapshot: null, cases: [], excluded_skill_owned_count: 0 },
      b: { id: "b2", agent_id: "ag1", kind: "full", status: "degraded", agent_snapshot: {}, recall: 0.8, precision: 0.9, citation_accuracy: 0.95, cost_usd: 0.02, ran_at: "2026-07-02T00:00:00.000Z", system_prompt_snapshot: null, cases: [], excluded_skill_owned_count: 0 },
      deltas: { recall: -0.2, precision: -0.1, citation_accuracy: -0.05, cost_usd: null },
      prompt_diff_available: false,
    };
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab agent={AGENT} />);

    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]!);
    await user.click(checkboxes[1]!);

    const panel = screen.getByTestId("batch-compare-panel");
    expect(panel).toBeInTheDocument();
    // Per-metric deltas are actually rendered, not just the panel shell.
    expect(within(panel).getByText("-20%")).toBeInTheDocument();
    expect(within(panel).getByText("-10%")).toBeInTheDocument();
    expect(within(panel).getByText("-5%")).toBeInTheDocument();
  });

  it("trend no longer duplicates per-run snapshot/cost under the chart (linked to batch history)", () => {
    cases = [makeCase()];
    trendPoints = [
      { batch_id: "b1", ran_at: "2026-07-01T00:00:00.000Z", recall: 1, precision: 1, citation_accuracy: 1, is_degraded: false, agent_snapshot: { display: { model: "gpt-4.1" } }, cost_usd: 0.034 },
    ];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    // The old per-batch marker row + floating tooltip are gone — snapshot/cost
    // live only in Batch History, which the chart highlights on hover.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trend-point-b1")).not.toBeInTheDocument();
    expect(screen.getByText(/Hover a point to highlight/)).toBeInTheDocument();
  });

  it("a never-run case shows no outcome text while a scored case shows its summary (AC-25/AC-26)", () => {
    cases = [
      makeCase({ id: "c1", name: "Never run case", last_run_status: "never_run", last_run_summary: null }),
      makeCase({ id: "c2", name: "Scored case", last_run_status: "passed", last_run_summary: "recall 100% · precision 100%" }),
    ];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    const neverRunRow = screen.getByTestId("eval-case-row-c1");
    const scoredRow = screen.getByTestId("eval-case-row-c2");
    expect(within(neverRunRow).queryByText(/recall/)).not.toBeInTheDocument();
    expect(within(scoredRow).getByText("recall 100% · precision 100%")).toBeInTheDocument();
  });

  it("a must_not_flag-only case renders the server's adapted wording verbatim, not a client-fabricated string (#15)", () => {
    // The server (`summaryForRun`) is the sole source of the must_not_flag-only
    // wording — this fixture supplies it as `last_run_summary` exactly as the
    // API would, and asserts the client renders that real field through
    // (previously masked by finding #15: a dead client branch + a fabricated
    // mock string gave a false green here).
    cases = [
      makeCase({
        id: "c1",
        name: "Guarded zone case",
        expected_output: [{ type: "must_not_flag", file: "a.ts", line_start: 5, line_end: 8 }],
        last_run_status: "passed",
        last_run_summary: "expected 0 flagged in guarded zone(s), got 0",
      }),
    ];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    const row = screen.getByTestId("eval-case-row-c1");
    expect(within(row).getByText("expected 0 flagged in guarded zone(s), got 0")).toBeInTheDocument();
  });

  it("an empty expected_output renders the explicit clean-diff indicator, not a blank subtitle (AC-9)", () => {
    cases = [makeCase({ id: "c1", name: "Clean diff case", expected_output: [] })];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    const row = screen.getByTestId("eval-case-row-c1");
    expect(within(row).getByText("Clean diff — no findings expected")).toBeInTheDocument();
  });

  it("renders the KPI delta strip vs. the previous full batch (AC-31)", () => {
    cases = [makeCase()];
    kpiDelta = { recall: -0.2, precision: 0.1, citation_accuracy: 0.05 };
    renderWithIntl(<EvalsTab agent={AGENT} />);

    const strip = screen.getByTestId("kpi-delta-strip");
    expect(within(strip).getByText("-20%")).toBeInTheDocument();
    expect(within(strip).getByText("+10%")).toBeInTheDocument();
    expect(within(strip).getByText("+5%")).toBeInTheDocument();
  });

  it("shows a muted no-baseline empty state when the KPI delta is null, not a fabricated 0", () => {
    cases = [makeCase()];
    kpiDelta = null;
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getByTestId("kpi-delta-empty")).toBeInTheDocument();
    expect(screen.getByText(/No baseline yet/)).toBeInTheDocument();
    expect(screen.queryByTestId("kpi-delta-strip")).not.toBeInTheDocument();
  });

  it("clear history requires confirmation before the clear-history mutation fires", async () => {
    cases = [makeCase()];
    batches = [
      { id: "b1", agent_id: "ag1", kind: "full", status: "clean", agent_snapshot: { display: { model: "gpt-4.1" } }, recall: 1, precision: 1, citation_accuracy: 1, cost_usd: 0.01, ran_at: "2026-07-01T00:00:00.000Z", system_prompt_snapshot: null },
    ];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab agent={AGENT} />);

    await user.click(screen.getByRole("button", { name: "Clear history" }));

    // Mutation must NOT fire yet — confirm modal must appear first.
    expect(clearHistoryMutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("This deletes all batch history and trend for this agent. Cases are kept."),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Clear history" }));
    expect(clearHistoryMutate).toHaveBeenCalled();
  });

  it("disables the clear-history button when there are no batches to clear", () => {
    cases = [makeCase()];
    batches = [];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getByRole("button", { name: "Clear history" })).toBeDisabled();
  });

  it("'View full dashboard' navigates to this agent's dashboard detail page (Step 14)", async () => {
    cases = [makeCase()];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab agent={AGENT} />);

    await user.click(screen.getByRole("button", { name: "View full dashboard" }));
    expect(routerPush).toHaveBeenCalledWith("/evals/ag1");
  });

  it("shows the per-case error message in the batch drill-down for an errored outcome, with full text in the title tooltip", async () => {
    cases = [makeCase()];
    batches = [
      { id: "b1", agent_id: "ag1", kind: "full", status: "degraded", agent_snapshot: { display: { model: "gpt-4.1" } }, recall: 0.8, precision: 0.9, citation_accuracy: 0.95, cost_usd: 0.02, ran_at: "2026-07-02T00:00:00.000Z", system_prompt_snapshot: null },
    ];
    const errorMessage = "ProviderTimeoutError: upstream request to anthropic timed out after 30000ms";
    batchDetail = {
      id: "b1",
      agent_id: "ag1",
      kind: "full",
      status: "degraded",
      agent_snapshot: {},
      recall: 0.8,
      precision: 0.9,
      citation_accuracy: 0.95,
      cost_usd: 0.02,
      ran_at: "2026-07-02T00:00:00.000Z",
      system_prompt_snapshot: null,
      excluded_skill_owned_count: 0,
      cases: [
        {
          case_id: "case1",
          case_name: "Case 1",
          status: "error",
          expected_count: 1,
          matched_count: 0,
          findings_count: 0,
          cost_usd: null,
          error_message: errorMessage,
        },
        {
          case_id: "case2",
          case_name: "Case 2",
          status: "passed",
          expected_count: 1,
          matched_count: 1,
          findings_count: 1,
          cost_usd: 0.01,
        },
      ],
    };
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab agent={AGENT} />);

    await user.click(screen.getByText(new Date("2026-07-02T00:00:00.000Z").toLocaleString()));

    const messageEl = screen.getByTitle(errorMessage);
    expect(messageEl).toBeInTheDocument();
    expect(messageEl).toHaveTextContent(errorMessage);

    // Passed row is unaffected — no stray error text attached to it.
    expect(screen.queryByText(/Case 2.*ProviderTimeoutError/)).not.toBeInTheDocument();
  });
});
