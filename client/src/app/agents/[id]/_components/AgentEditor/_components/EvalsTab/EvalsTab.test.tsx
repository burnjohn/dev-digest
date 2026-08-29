/**
 * EvalsTab — the agent editor's `Evals` tab. `@testing-library/user-event` is
 * not a client/ dependency (verified, absent from package.json/lockfile/
 * node_modules) — every interaction here uses `fireEvent`, matching the rest
 * of this package's `*.test.tsx` files.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EVAL_BATCH_CONCURRENCY } from "@devdigest/shared";
import type {
  Agent,
  EvalBatchCaseResult,
  EvalBatchDetail,
  EvalBatchRecord,
  EvalCaseRunResult,
  EvalOwnerDashboard,
} from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import commonMessages from "../../../../../../../../messages/en/common.json";
import type { EvalCaseListItem } from "@/lib/hooks/evals";

// ---- Hook boundary mocks (client/INSIGHTS.md 2026-08-09 seed: mock the hook
// boundary, never global fetch). One shared module mock serves both EvalsTab
// AND the real EvalCaseEditor it renders — the editor imports the same
// `@/lib/hooks/evals` module, so every hook it needs must be covered here too. ----

let casesState: { data?: EvalCaseListItem[]; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
};
let dashState: { data?: EvalOwnerDashboard; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
let batchesState: { data?: EvalBatchRecord[]; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
};
let activeBatchState: { data?: EvalBatchDetail; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};

const refetch = vi.fn();
const startMutateAsync = vi.fn();
const runMutate = vi.fn();
const deleteMutate = vi.fn();
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

let runState: { isPending: boolean; variables?: string; runningIds: string[] } = {
  isPending: false,
  runningIds: [],
};
let deleteState: { isPending: boolean; variables?: string } = { isPending: false };
let startState: { isPending: boolean } = { isPending: false };

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => ({ ...casesState, refetch }),
  useEvalOwnerDashboard: () => ({ ...dashState, refetch }),
  useEvalBatches: () => ({ ...batchesState, refetch }),
  useEvalBatch: () => ({ ...activeBatchState }),
  useStartEvalBatch: () => ({ mutateAsync: startMutateAsync, isPending: startState.isPending }),
  useRunEvalCase: () => ({
    mutate: runMutate,
    isPending: runState.isPending,
    variables: runState.variables,
    runningIds: runState.runningIds,
  }),
  useDeleteEvalCase: () => ({ mutate: deleteMutate, isPending: deleteState.isPending, variables: deleteState.variables }),
  useCreateEvalCase: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";
import { TABS, VALID_TABS } from "../../constants";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  casesState = { data: [], isLoading: false, isError: false };
  dashState = { data: undefined, isLoading: false, isError: false };
  batchesState = { data: [], isLoading: false, isError: false };
  activeBatchState = { data: undefined, isLoading: false, isError: false };
  runState = { isPending: false, runningIds: [] };
  deleteState = { isPending: false };
  startState = { isPending: false };
});

function agent(): Agent {
  return {
    id: "agent-1",
    name: "Reviewer",
    provider: "anthropic",
    model: "claude",
    enabled: true,
    system_prompt: "",
    version: 1,
  } as Agent;
}

function dashboard(over: Partial<EvalOwnerDashboard> = {}): EvalOwnerDashboard {
  return {
    owner_kind: "agent",
    owner_id: "agent-1",
    cases_total: 1,
    latest_batch: null,
    delta: { recall: null, precision: null, citation_accuracy: null },
    trend: [],
    recent_batches: [],
    alert: null,
    ...over,
  };
}

function batchRecord(over: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    id: "batch-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    owner_version: 1,
    runner_agent_id: null,
    runner_agent_version: null,
    started_at: "2026-08-28T00:00:00Z",
    finished_at: null,
    status: "running",
    recall: null,
    precision: null,
    citation_accuracy: null,
    cases_passed: 0,
    cases_total: 2,
    cost_usd: null,
    ...over,
  };
}

function batchCaseResult(over: Partial<EvalBatchCaseResult> = {}): EvalBatchCaseResult {
  return {
    case_id: "case-1",
    case_name: "case-1",
    errored: false,
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    skill_lift: null,
    ...over,
  };
}

function runResult(over: Partial<EvalCaseRunResult> = {}): EvalCaseRunResult {
  return {
    id: "run-1",
    case_id: "case-1",
    pass: true,
    actual_output: [],
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    ...over,
  } as EvalCaseRunResult;
}

function caseItem(over: Partial<EvalCaseListItem> = {}): EvalCaseListItem {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "case-1",
    expectation_kind: "must_find",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [
      { severity: "CRITICAL", category: "security", title: "x", start_line: 1, end_line: 1, file: "a.ts" },
    ],
    forbidden_regions: null,
    filename: null,
    notes: null,
    latest_run: null,
    ...over,
  };
}

function renderTab() {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
      <EvalsTab agent={agent()} />
    </NextIntlClientProvider>,
  );
}

describe("AgentEditor TABS — REQ-39", () => {
  it("gains exactly one new entry, Evals, after Context — no Stats, no CI", () => {
    const keys = TABS.map((t) => t.key);
    expect(keys).toEqual(["config", "skills", "context", "evals"]);
    expect(keys).not.toContain("stats");
    expect(keys).not.toContain("ci");
    expect(VALID_TABS).toContain("evals");
  });
});

describe("EvalsTab", () => {
  it("REQ-7: renders the server's order verbatim — a fixture deliberately NOT in name order stays in DOM order", () => {
    dashState = { data: dashboard({ cases_total: 3 }), isLoading: false, isError: false };
    casesState = {
      data: [caseItem({ id: "z", name: "z-case" }), caseItem({ id: "a", name: "a-case" }), caseItem({ id: "m", name: "m-case" })],
      isLoading: false,
      isError: false,
    };
    renderTab();
    const names = screen.getAllByText(/-case$/).map((el) => el.textContent);
    expect(names).toEqual(["z-case", "a-case", "m-case"]);
  });

  it("REQ-8: a case with a run renders a pass/fail marker and 'expected n finding(s), got m' with correct plural", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = {
      data: [
        caseItem({
          id: "pass-case",
          name: "pass-case",
          expected_output: [
            { severity: "CRITICAL", category: "security", title: "x", start_line: 1, end_line: 1, file: "a.ts" },
          ],
          latest_run: {
            run_id: "r1",
            case_id: "pass-case",
            ran_at: "x",
            pass: true,
            recall: 1,
            precision: 1,
            citation_accuracy: 1,
            actual_output: [{ a: 1 }],
            ablation: null,
            duration_ms: 100,
            cost_usd: 0.01,
          },
        }),
      ],
      isLoading: false,
      isError: false,
    };
    renderTab();
    expect(screen.getByText("expected 1 finding, got 1 · recall 100%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "passed" })).toBeInTheDocument();
  });

  it("REQ-9: a case with no run renders 'never run' and a neutral marker — no pass/fail marker", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = { data: [caseItem({ latest_run: null })], isLoading: false, isError: false };
    renderTab();
    expect(screen.getByText("never run")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "passed" })).toBeNull();
    expect(screen.queryByRole("img", { name: "failed" })).toBeNull();
  });

  it("REQ-13: Run all evals is disabled with an accessible reason for an empty set", () => {
    dashState = { data: dashboard({ cases_total: 0 }), isLoading: false, isError: false };
    casesState = { data: [], isLoading: false, isError: false };
    renderTab();
    const btn = screen.getByRole("button", { name: /Run all evals/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAccessibleName(/Run all evals.*Add an eval case/i);
    expect(screen.getByText("No eval cases yet. Create one to assert this agent's expected findings on a sample diff.")).toBeInTheDocument();
  });

  it("REQ-13: with cases and no batch in flight, Run all evals posts exactly once", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = { data: [caseItem()], isLoading: false, isError: false };
    startMutateAsync.mockResolvedValue({ batch_id: "batch-new" });
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Run all evals" }));
    expect(startMutateAsync).toHaveBeenCalledTimes(1);
    expect(startMutateAsync).toHaveBeenCalledWith({ owner_kind: "agent", owner_id: "agent-1" });
  });

  it("REQ-13: disabled with an accessible reason while a batch is already in flight", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = { data: [caseItem()], isLoading: false, isError: false };
    batchesState = { data: [batchRecord({ status: "running" })], isLoading: false, isError: false };
    activeBatchState = { data: { ...batchRecord({ status: "running" }), cases: [] }, isLoading: false, isError: false };
    renderTab();
    const btn = screen.getByRole("button", { name: /Running.*already running/i });
    expect(btn).toBeDisabled();
  });

  it("REQ-17: while non-terminal, announces progress via aria-live=polite and polling stops once terminal", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = { data: [caseItem()], isLoading: false, isError: false };
    batchesState = { data: [batchRecord({ status: "running" })], isLoading: false, isError: false };
    activeBatchState = {
      data: { ...batchRecord({ status: "running", cases_total: 4 }), cases: [
        { case_id: "1", case_name: "a", errored: false, pass: true, recall: 1, precision: 1, citation_accuracy: 1, skill_lift: null },
      ] },
      isLoading: false,
      isError: false,
    };
    renderTab();
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("1/4");

    // Terminal status: the progress region disappears and the action re-enables.
    cleanup();
    activeBatchState = {
      data: { ...batchRecord({ status: "succeeded", cases_total: 4, cases_passed: 4 }), cases: [] },
      isLoading: false,
      isError: false,
    };
    batchesState = { data: [batchRecord({ status: "succeeded" })], isLoading: false, isError: false };
    renderTab();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeEnabled();
  });

  it("REQ-25: an agent with cases and zero batches renders — for all four EVAL METRICS figures", () => {
    dashState = { data: dashboard({ latest_batch: null }), isLoading: false, isError: false };
    casesState = { data: [caseItem()], isLoading: false, isError: false };
    renderTab();
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  it("an agent with zero cases renders the empty state with + New eval case", () => {
    dashState = { data: dashboard({ cases_total: 0 }), isLoading: false, isError: false };
    casesState = { data: [], isLoading: false, isError: false };
    renderTab();
    expect(screen.getByRole("button", { name: "New case" })).toBeInTheDocument();
  });

  it("appends ' · recall <p>%' only when the run recorded a recall — a null-recall run's line ends at 'got <m>'", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = {
      data: [
        caseItem({
          id: "no-recall",
          name: "no-recall-case",
          expectation_kind: "must_not_flag",
          expected_output: [],
          latest_run: {
            run_id: "r9",
            case_id: "no-recall",
            ran_at: "x",
            pass: true,
            recall: null,
            precision: null,
            citation_accuracy: null,
            actual_output: [],
            ablation: null,
            duration_ms: 100,
            cost_usd: 0.01,
          },
        }),
      ],
      isLoading: false,
      isError: false,
    };
    renderTab();
    expect(screen.getByText("expected 0 findings, got 0")).toBeInTheDocument();
    // Scoped to the suffix, not the bare word: `EVAL METRICS` renders its own
    // "Recall" card label on the same screen.
    expect(screen.queryByText(/· recall/)).toBeNull();
  });

  it("labels each row with what it asserts: MUST FIND on a case with expectations, MUST NOT FLAG on an empty one", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = {
      data: [
        caseItem({ id: "pos", name: "pos-case" }),
        caseItem({ id: "neg", name: "neg-case", expectation_kind: "must_not_flag", expected_output: [] }),
      ],
      isLoading: false,
      isError: false,
    };
    renderTab();
    expect(screen.getByText("Must find")).toBeInTheDocument();
    expect(screen.getByText("Must not flag")).toBeInTheDocument();
  });

  it("AC-46: a must_not_flag row carries the pill INSTEAD of a severity badge, and no longer says 'empty []'", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = {
      data: [caseItem({ name: "neg-case", expectation_kind: "must_not_flag", expected_output: [] })],
      isLoading: false,
      isError: false,
    };
    renderTab();
    expect(screen.getByText("Must not flag")).toBeInTheDocument();
    expect(screen.queryByText("empty []")).toBeNull();
    expect(screen.queryByText(/CRITICAL/)).toBeNull();
  });

  // Mutation this kills: rendering the pill from `item.expectation_kind` raw.
  // A legacy row served with a NULL kind but real findings must not show a
  // MUST NOT FLAG pill beside its CRITICAL badge.
  it("a row storing findings reads MUST FIND even if the server sent must_not_flag, and keeps its severity badge", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = {
      data: [caseItem({ name: "legacy", expectation_kind: "must_not_flag" })],
      isLoading: false,
      isError: false,
    };
    renderTab();
    expect(screen.getByText("Must find")).toBeInTheDocument();
    expect(screen.queryByText("Must not flag")).toBeNull();
    expect(screen.getByText(/CRITICAL/)).toBeInTheDocument();
  });

  // Mutation this kills: leaving a row's Run button labelled `Run` while its
  // request is in flight (disabled-but-unchanged), which read as a dead click
  // for the whole seconds-long round trip.
  it("the running case says Running… and keeps its name in its accessible one", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = { data: [caseItem({ id: "case-1", name: "running-case" })], isLoading: false, isError: false };
    runState = { isPending: true, variables: "case-1", runningIds: ["case-1"] };
    renderTab();

    // WCAG 2.5.3: the accessible name still STARTS with the visible label.
    const busy = screen.getByRole("button", { name: /^Running… — running-case/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveTextContent("Running…");
  });

  // Mutation this kills: deriving a row's spinner from the mutation's single
  // `variables`, or disabling every row while one runs — single-case runs are
  // independent requests and must be startable while others are still going.
  it("two single-case runs at once spin on BOTH their rows, and a third row stays clickable", () => {
    dashState = { data: dashboard({ cases_total: 3 }), isLoading: false, isError: false };
    casesState = {
      data: [
        caseItem({ id: "case-1", name: "first-case" }),
        caseItem({ id: "case-2", name: "second-case" }),
        caseItem({ id: "case-3", name: "idle-case" }),
      ],
      isLoading: false,
      isError: false,
    };
    // `variables` names only the LATEST call; `runningIds` is both of them.
    runState = { isPending: true, variables: "case-2", runningIds: ["case-1", "case-2"] };
    renderTab();

    expect(screen.getByRole("button", { name: /^Running… — first-case/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Running… — second-case/ })).toBeDisabled();

    const idle = screen.getByRole("button", { name: /^Run — idle-case/ });
    expect(idle).toBeEnabled();
    fireEvent.click(idle);
    expect(runMutate).toHaveBeenCalledWith("case-3");
  });

  it("no run in flight: every row's Run is enabled and reads Run", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = { data: [caseItem({ name: "my-case" })], isLoading: false, isError: false };
    renderTab();
    const btn = screen.getByRole("button", { name: /^Run — my-case/ });
    expect(btn).toBeEnabled();
    expect(screen.queryByText("Running…")).toBeNull();
  });

  // Mutation this kills: showing every case in a batch as `Running…`. The
  // server's pool is bounded (`EVAL_BATCH_CONCURRENCY`), so only that many
  // cases hold a live LLM call and the rest are waiting for a free worker.
  // The fixture is sized off the constant so raising it cannot leave this
  // test asserting a stale shape.
  it("Run all evals: the scored case keeps its verdict, the pool runs, the overflow is Queued", () => {
    const live = Array.from({ length: EVAL_BATCH_CONCURRENCY }, (_, i) =>
      caseItem({ id: `live-${i}`, name: `live-case-${i}` }),
    );
    const total = live.length + 2;
    dashState = { data: dashboard({ cases_total: total }), isLoading: false, isError: false };
    casesState = {
      data: [
        caseItem({ id: "case-1", name: "done-case", latest_run: runResult() }),
        ...live,
        caseItem({ id: "case-last", name: "waiting-case" }),
      ],
      isLoading: false,
      isError: false,
    };
    batchesState = {
      data: [batchRecord({ status: "running", cases_total: total })],
      isLoading: false,
      isError: false,
    };
    activeBatchState = {
      data: { ...batchRecord({ cases_total: total }), cases: [batchCaseResult({ case_id: "case-1" })] },
      isLoading: false,
      isError: false,
    };
    renderTab();

    expect(screen.getByRole("button", { name: /^Run — done-case/ })).toBeInTheDocument();
    for (const c of live) {
      expect(screen.getByRole("button", { name: new RegExp(`^Running… — ${c.name}`) })).toBeDisabled();
    }
    const waiting = screen.getByRole("button", { name: /^Queued — waiting-case/ });
    expect(waiting).toBeDisabled();
    expect(waiting).toHaveTextContent("Queued");
  });

  it("+ New eval case and a row's Edit both open the shared EvalCaseEditor (components/eval-case-editor)", () => {
    dashState = { data: dashboard(), isLoading: false, isError: false };
    casesState = { data: [caseItem({ name: "my-case" })], isLoading: false, isError: false };
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: "New case" }));
    expect(screen.getByText("New eval case")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /Edit — my-case/i }));
    expect(screen.getByText("Eval case · my-case")).toBeInTheDocument();
  });
});
