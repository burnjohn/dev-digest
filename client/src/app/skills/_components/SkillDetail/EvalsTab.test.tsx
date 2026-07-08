import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor, act } from "@testing-library/react";
import { createRef } from "react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillEvalCaseListItem, SkillEvalBatch } from "@devdigest/shared";
import skillsMessages from "../../../../../messages/en/skills.json";

// ---- Mocks -----------------------------------------------------------------

let cases: SkillEvalCaseListItem[] = [];
let batches: SkillEvalBatch[] = [];
// Controls what the completion-poll hook (`useSkillEvalBatchDetail`) returns —
// `undefined` = not polling / no pending batch; `{ status: null }` = in flight;
// `{ status: 'clean' }` = sealed (triggers the refresh effect in EvalsTab).
let batchDetail: { status: string | null } | undefined = undefined;
let trendPoints: unknown[] = [];
let kpiDelta: unknown = null;

const runBatchMutate = vi.fn();
let runBatchIsPending = false;
const deleteCaseMutate = vi.fn();
const createCaseMutate = vi.fn();
let createCaseIsPending = false;
const updateCaseMutate = vi.fn();
let updateCaseIsPending = false;
const clearHistoryMutate = vi.fn();
let clearHistoryIsPending = false;

vi.mock("@/lib/hooks/skills", () => ({
  useSkillEvals: () => ({ data: cases, isLoading: false }),
  useSkillEvalBatchHistory: () => ({ data: batches, isLoading: false }),
  useRunSkillEvalBatch: () => ({ mutate: runBatchMutate, isPending: runBatchIsPending }),
  useSkillEvalBatchDetail: () => ({ data: batchDetail }),
  useDeleteSkillEval: () => ({ mutate: deleteCaseMutate }),
  useCreateSkillEval: () => ({ mutate: createCaseMutate, isPending: createCaseIsPending }),
  useUpdateSkillEvalCase: () => ({ mutate: updateCaseMutate, isPending: updateCaseIsPending }),
  useSkillEvalTrend: () => ({ data: trendPoints, isLoading: false }),
  useSkillEvalKpiDelta: () => ({ data: kpiDelta, isLoading: false }),
  useClearSkillEvalHistory: () => ({ mutate: clearHistoryMutate, isPending: clearHistoryIsPending }),
  useSkillEvalCompare: () => ({ data: undefined }),
}));

let agentsData: Array<{ id: string; name: string }> | undefined = [{ id: "a1", name: "General Reviewer" }];

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: agentsData }),
}));

import { EvalsTab, type EvalsTabHandle } from "./EvalsTab";

function renderWithIntl(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, invalidateSpy };
}

const SKILL: Skill = {
  id: "sk1",
  name: "no-mock-overuse",
  description: "Flags overuse of mocks",
  type: "rubric",
  source: "manual",
  body: "# No mock overuse",
  enabled: true,
  version: 1,
} as unknown as Skill;

function makeCase(overrides: Partial<SkillEvalCaseListItem> = {}): SkillEvalCaseListItem {
  return {
    id: "case1",
    skill_id: "sk1",
    name: "Case 1",
    source: "manual",
    source_finding_id: null,
    source_pr_number: null,
    fixture: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-x\n+y",
    practices: ["review output identifies the mock overuse"],
    grounding: ["mocking the system under test"],
    threshold: 0.6,
    last_run_status: "never_run",
    last_run_summary: null,
    last_host_agent_id: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  cases = [];
  batches = [];
  batchDetail = undefined;
  trendPoints = [];
  kpiDelta = null;
  runBatchMutate.mockReset();
  runBatchIsPending = false;
  deleteCaseMutate.mockClear();
  createCaseMutate.mockClear();
  createCaseIsPending = false;
  updateCaseMutate.mockClear();
  updateCaseIsPending = false;
  clearHistoryMutate.mockClear();
  clearHistoryIsPending = false;
  agentsData = [{ id: "a1", name: "General Reviewer" }];
});

describe("EvalsTab — empty state", () => {
  it("renders both CTAs when there are zero cases", () => {
    renderWithIntl(<EvalsTab skill={SKILL} />);

    expect(screen.getByText("No eval cases yet")).toBeInTheDocument();
    expect(screen.getByText(/Attribute to skill/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New eval case" })).toBeInTheDocument();
  });
});

describe("EvalsTab — case list status states (AC-30)", () => {
  it("renders all 5 status states with visually distinct failed_grounding vs failed_judge icons", () => {
    cases = [
      makeCase({ id: "c1", name: "Never run case", last_run_status: "never_run" }),
      makeCase({ id: "c2", name: "Passed case", last_run_status: "passed" }),
      makeCase({ id: "c3", name: "Failed grounding case", last_run_status: "failed_grounding" }),
      makeCase({ id: "c4", name: "Failed judge case", last_run_status: "failed_judge" }),
      makeCase({ id: "c5", name: "Error case", last_run_status: "error" }),
    ];
    renderWithIntl(<EvalsTab skill={SKILL} />);

    const rows = {
      c1: screen.getByTestId("skill-eval-case-row-c1"),
      c2: screen.getByTestId("skill-eval-case-row-c2"),
      c3: screen.getByTestId("skill-eval-case-row-c3"),
      c4: screen.getByTestId("skill-eval-case-row-c4"),
      c5: screen.getByTestId("skill-eval-case-row-c5"),
    };
    Object.values(rows).forEach((row) => expect(row).toBeInTheDocument());

    // Each row's status icon carries a distinct accessible label.
    expect(within(rows.c1).getByLabelText("Never run")).toBeInTheDocument();
    expect(within(rows.c2).getByLabelText("Passed")).toBeInTheDocument();
    expect(within(rows.c3).getByLabelText("Failed grounding")).toBeInTheDocument();
    expect(within(rows.c4).getByLabelText("Failed judge")).toBeInTheDocument();
    expect(within(rows.c5).getByLabelText("Error")).toBeInTheDocument();

    // failed_grounding and failed_judge must render visually distinct icons
    // (different lucide icon svg AND different inline color) — never the
    // same icon/color pairing. `stroke` is always "currentColor" for lucide
    // icons (the `color` prop sets inline style.color, not the stroke
    // attribute — client/insights.md's 2026-06-30 Quirk), so compare the
    // lucide icon class name and the inline style color instead.
    const groundingIcon = within(rows.c3).getByLabelText("Failed grounding");
    const judgeIcon = within(rows.c4).getByLabelText("Failed judge");
    expect(groundingIcon.getAttribute("class")).not.toBe(judgeIcon.getAttribute("class"));
    expect(groundingIcon.style.color).not.toBe(judgeIcon.style.color);
  });
});

describe("EvalsTab — run all via exposed handle (AC-11)", () => {
  it("runAll() triggers the run mutation with the selected host agent id", async () => {
    cases = [makeCase()];
    const ref = createRef<EvalsTabHandle>();
    const onRunStateChange = vi.fn();
    renderWithIntl(<EvalsTab skill={SKILL} ref={ref} onRunStateChange={onRunStateChange} />);

    // HostAgentSelect applies its default ("General Reviewer" → a1) on mount;
    // wait until the run becomes available, then fire via the header-exposed handle.
    await waitFor(() =>
      expect(onRunStateChange).toHaveBeenLastCalledWith({ canRunAll: true, running: false }),
    );
    await act(async () => {
      ref.current!.runAll();
    });

    expect(runBatchMutate).toHaveBeenCalledWith(
      { host_agent_id: "a1" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("reports canRunAll=false via onRunStateChange when there is no host agent", async () => {
    agentsData = [];
    cases = [makeCase()];
    const onRunStateChange = vi.fn();
    renderWithIntl(<EvalsTab skill={SKILL} onRunStateChange={onRunStateChange} />);

    await waitFor(() => expect(onRunStateChange).toHaveBeenCalled());
    expect(onRunStateChange).toHaveBeenLastCalledWith({ canRunAll: false, running: false });
  });
});

describe("EvalsTab — run completion polling (202 + poll)", () => {
  it("reports running=true (no re-enable at 202) while the fired batch is in flight", async () => {
    cases = [makeCase()];
    batchDetail = { status: null }; // in flight once the run fires
    runBatchMutate.mockImplementation((_body: unknown, opts: { onSuccess?: (r: { batch_id: string }) => void }) =>
      opts?.onSuccess?.({ batch_id: "b1" }),
    );
    const ref = createRef<EvalsTabHandle>();
    const onRunStateChange = vi.fn();
    renderWithIntl(<EvalsTab skill={SKILL} ref={ref} onRunStateChange={onRunStateChange} />);

    await waitFor(() =>
      expect(onRunStateChange).toHaveBeenLastCalledWith({ canRunAll: true, running: false }),
    );
    await act(async () => {
      ref.current!.runAll();
    });

    // pendingBatchId is set → running stays true / canRunAll false until the
    // batch seals, so the header button never re-enables at the 202 (no
    // overlapping second run against the same skill).
    await waitFor(() =>
      expect(onRunStateChange).toHaveBeenLastCalledWith({ canRunAll: false, running: true }),
    );
  });

  it("refreshes case statuses + history once the polled batch is sealed (status != null)", async () => {
    cases = [makeCase()];
    batchDetail = { status: "clean" }; // already sealed when onSuccess sets pendingBatchId
    runBatchMutate.mockImplementation((_body: unknown, opts: { onSuccess?: (r: { batch_id: string }) => void }) =>
      opts?.onSuccess?.({ batch_id: "b1" }),
    );
    const ref = createRef<EvalsTabHandle>();
    const onRunStateChange = vi.fn();
    const { invalidateSpy } = renderWithIntl(
      <EvalsTab skill={SKILL} ref={ref} onRunStateChange={onRunStateChange} />,
    );

    await waitFor(() =>
      expect(onRunStateChange).toHaveBeenLastCalledWith({ canRunAll: true, running: false }),
    );
    await act(async () => {
      ref.current!.runAll();
    });

    // The completion effect invalidates BOTH the case list and the batch
    // history so freshly-sealed results show without a manual page reload.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skill-evals", "sk1"] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["skill-eval-batches", "sk1"] });
    });
  });
});

describe("EvalsTab — delete confirmation (AC-9)", () => {
  it("requires confirmation before deleting a case", async () => {
    cases = [makeCase({ id: "c1", name: "Delete me" })];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab skill={SKILL} />);

    const row = screen.getByTestId("skill-eval-case-row-c1");
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    expect(deleteCaseMutate).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText('Delete "Delete me"? This cannot be undone.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(deleteCaseMutate).toHaveBeenCalledWith("c1");
  });
});

describe("EvalsTab — Case Editor threshold validation (AC-39)", () => {
  it("shows an inline error and does not close the editor when threshold is out of range", async () => {
    cases = [makeCase()];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab skill={SKILL} />);

    await user.click(screen.getByRole("button", { name: "+ New eval case" }));

    const fixtureInput = screen.getByPlaceholderText("Paste a unified diff fragment…");
    await user.type(fixtureInput, "@@ -1,2 +1,2 @@\n-x\n+y");

    const thresholdInput = screen.getByDisplayValue("0.6");
    await user.clear(thresholdInput);
    await user.type(thresholdInput, "1.5");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Threshold must be between 0 and 1.")).toBeInTheDocument();
    expect(createCaseMutate).not.toHaveBeenCalled();
    // Editor stays open — the modal dialog is still in the document.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("EvalsTab — Case Editor practice/grounding row add/remove", () => {
  it("adds a practice row and a grounding row, fills them, removes one, and submits the surviving values", async () => {
    cases = [makeCase()];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab skill={SKILL} />);

    await user.click(screen.getByRole("button", { name: "+ New eval case" }));

    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByPlaceholderText("Paste a unified diff fragment…"),
      "@@ -1,2 +1,2 @@\n-x\n+y",
    );

    // Add two practice rows and fill both.
    await user.click(within(dialog).getByRole("button", { name: "+ Add practice" }));
    await user.click(within(dialog).getByRole("button", { name: "+ Add practice" }));
    const practicePlaceholder = "e.g. review output identifies the missing null check";
    const practiceInputs = within(dialog).getAllByPlaceholderText(practicePlaceholder);
    expect(practiceInputs).toHaveLength(2);
    await user.type(practiceInputs[0]!, "flags the missing null check");
    await user.type(practiceInputs[1]!, "this one gets removed");

    // Add a grounding row and fill it.
    await user.click(within(dialog).getByRole("button", { name: "+ Add grounding term" }));
    const groundingInput = within(dialog).getByPlaceholderText("e.g. Math.random()");
    await user.type(groundingInput, "nullCheck");

    // Remove the SECOND practice row — both practice and grounding sections
    // share the label "Remove" (messages/en/skills.json), so scope by the
    // row containing the text we just typed rather than picking the first
    // "Remove" button in the whole dialog.
    const secondPracticeRow = practiceInputs[1]!.closest("div")!.parentElement as HTMLElement;
    await user.click(within(secondPracticeRow).getByRole("button", { name: "Remove" }));

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(createCaseMutate).toHaveBeenCalledOnce();
    const submitted = createCaseMutate.mock.calls[0]![0];
    expect(submitted.practices).toEqual(["flags the missing null check"]);
    expect(submitted.grounding).toEqual(["nullCheck"]);
  });

  it("pre-fills existing practice/grounding rows when editing a case, and persists an edit after removing a row", async () => {
    const existing = makeCase({
      id: "c1",
      practices: ["practice one", "practice two"],
      grounding: ["term one"],
    });
    cases = [existing];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab skill={SKILL} />);

    const row = screen.getByTestId("skill-eval-case-row-c1");
    await user.click(within(row).getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("practice one")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("practice two")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("term one")).toBeInTheDocument();

    // Remove the sole grounding row — practices alone still satisfy AC-2, so
    // Save must succeed with an empty grounding array.
    const groundingRow = screen.getByDisplayValue("term one").closest("div")!.parentElement as HTMLElement;
    await user.click(within(groundingRow).getByRole("button", { name: "Remove" }));

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateCaseMutate).toHaveBeenCalledOnce();
    const submitted = updateCaseMutate.mock.calls[0]![0];
    expect(submitted.caseId).toBe("c1");
    expect(submitted.input.practices).toEqual(["practice one", "practice two"]);
    expect(submitted.input.grounding).toEqual([]);
  });
});

describe("EvalsTab — case row Run/Edit actions", () => {
  it("runs a single case via its row's Run button once a host agent is selected", async () => {
    cases = [makeCase({ id: "c1", name: "Case to run" })];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab skill={SKILL} />);

    const row = screen.getByTestId("skill-eval-case-row-c1");
    await user.click(within(row).getByRole("button", { name: "Run" }));

    expect(runBatchMutate).toHaveBeenCalledWith(
      { case_ids: ["c1"], host_agent_id: "a1" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("opens the editor pre-filled with the row's own case when Edit is clicked", async () => {
    cases = [makeCase({ id: "c1", name: "Editable case", practices: ["existing practice"] })];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab skill={SKILL} />);

    const row = screen.getByTestId("skill-eval-case-row-c1");
    await user.click(within(row).getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Edit eval case")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Editable case")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("existing practice")).toBeInTheDocument();
  });
});

describe("EvalsTab — Clear History (trend/compare/checkbox-select handoff)", () => {
  it("disables Clear History when there are zero batches, and requires ConfirmModal confirmation before calling the mutation", async () => {
    cases = [makeCase()];
    batches = [];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab skill={SKILL} />);

    const clearButton = screen.getByRole("button", { name: "Clear history" });
    expect(clearButton).toBeDisabled();
  });

  it("calls the clear-history mutation only after the confirm dialog is confirmed", async () => {
    cases = [makeCase()];
    batches = [
      {
        id: "batch-1",
        skill_id: "sk1",
        host_agent_id: "a1",
        kind: "full",
        status: "clean",
        snapshot_identity: {},
        model: "gpt-4.1",
        judge_score: 0.5,
        grounding_pass_rate: 1,
        cases_passing: 1,
        cases_total: 1,
        cost_usd: 0.01,
        ran_at: "2026-07-06T00:00:00Z",
      },
    ];
    const user = userEvent.setup();
    renderWithIntl(<EvalsTab skill={SKILL} />);

    const clearButton = screen.getByRole("button", { name: "Clear history" });
    expect(clearButton).toBeEnabled();
    await user.click(clearButton);
    expect(clearHistoryMutate).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Clear eval history")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Clear history" }));

    expect(clearHistoryMutate).toHaveBeenCalledOnce();
  });
});

describe("EvalsTab — metrics strip reads the newest batch (batches[0])", () => {
  it("renders judge score / grounding pass rate / cases passing / cost from the first (newest) batch, not an older one", () => {
    cases = [makeCase()];
    batches = [
      {
        id: "batch-newest",
        skill_id: "sk1",
        host_agent_id: "a1",
        kind: "full",
        status: "clean",
        snapshot_identity: {},
        model: "gpt-4.1",
        judge_score: 0.75,
        grounding_pass_rate: 1,
        cases_passing: 3,
        cases_total: 4,
        cost_usd: 0.0123,
        ran_at: "2026-07-06T00:00:00Z",
      },
      {
        id: "batch-older",
        skill_id: "sk1",
        host_agent_id: "a1",
        kind: "full",
        status: "clean",
        snapshot_identity: {},
        model: "gpt-4.1",
        judge_score: 0.1,
        grounding_pass_rate: 0.2,
        cases_passing: 1,
        cases_total: 4,
        cost_usd: 0.5,
        ran_at: "2026-07-01T00:00:00Z",
      },
    ];
    renderWithIntl(<EvalsTab skill={SKILL} />);

    // Scope to the metrics strip itself ("Eval metrics" heading's container)
    // — the batch HISTORY table below renders every batch's own figures as
    // plain text too, so an unscoped screen.getByText would also match the
    // older batch's row.
    const metricsHeading = screen.getByText("Eval metrics");
    const metricsStrip = metricsHeading.closest("div")!.parentElement as HTMLElement;

    expect(within(metricsStrip).getByText("75%")).toBeInTheDocument();
    expect(within(metricsStrip).getByText("100%")).toBeInTheDocument();
    expect(within(metricsStrip).getByText("3/4")).toBeInTheDocument();
    expect(within(metricsStrip).getByText("$0.0123")).toBeInTheDocument();

    // The older batch's figures must NOT appear within the metrics strip.
    expect(within(metricsStrip).queryByText("10%")).not.toBeInTheDocument();
    expect(within(metricsStrip).queryByText("$0.50")).not.toBeInTheDocument();
  });

  it("shows placeholder dashes for every metric when no batch has ever run", () => {
    cases = [makeCase()];
    batches = [];
    renderWithIntl(<EvalsTab skill={SKILL} />);

    // 3 of the 4 metric cards render a bare "—"; cases passing renders "—" too
    // (guarded jointly on cases_passing/cases_total being non-null).
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
