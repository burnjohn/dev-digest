/**
 * EvalsTab — the skill editor's `Evals` tab (SPEC-03 T19). Case list only:
 * no metric cards, no deltas, no alert banner, no trend chart, no batch
 * history (owner decision, plan §1.2).
 *
 * `@testing-library/user-event` is NOT a `client/` dependency (verified this
 * run — absent from `package.json`, `pnpm-lock.yaml` and `node_modules`), so
 * every interaction here uses `fireEvent`, matching every other `*.test.tsx`
 * in this package.
 *
 * Mocks at the hook boundary (`@/lib/hooks/evals`), never global `fetch` —
 * `client/INSIGHTS.md` 2026-08-09 (seed). The SAME mock backs both this tab's
 * own hooks and `EvalCaseEditor`'s (T14) — the editor is imported for real,
 * never stubbed or forked, so its internal `useCreateEvalCase` /
 * `useUpdateEvalCase` calls resolve against this file's mocks too.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EVAL_BATCH_CONCURRENCY } from "@devdigest/shared";
import type { EvalBatchDetail, EvalBatchRecord, Skill } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";
import commonMessages from "../../../../../../../../messages/en/common.json";
import { ToastProvider } from "@/lib/toast";
import type { EvalCaseListItem } from "@/lib/hooks/evals";

const casesSpy = vi.fn();
const runMutateAsync = vi.fn();
const deleteMutateAsync = vi.fn();
const startBatchMutateAsync = vi.fn();
const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();

// Mocks the hook boundary for BOTH this tab's own hooks and T14's
// `EvalCaseEditor` (rendered for real below, never stubbed or forked) —
// they import the same module specifier, so one mock backs both.
vi.mock("@/lib/hooks/evals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks/evals")>();
  return {
    ...actual,
    useEvalCases: () => casesSpy(),
    // `runningIds` — not `isPending` — is what the tab reads per row, so a
    // partial mock that omits it silently renders every row as idle.
    useRunEvalCase: () => ({ mutateAsync: runMutateAsync, isPending: false, runningIds: runningIds() }),
    // Batch polling: this mock is `importOriginal`-based, so a hook left out
    // here runs FOR REAL and throws "No QueryClient set" (client/INSIGHTS.md
    // 2026-08-29) — every hook the component calls must be listed.
    useEvalBatches: () => ({ data: batchesState.data, isLoading: false, isError: false }),
    useEvalBatch: () => ({ data: activeBatchState.data, isLoading: false, isError: false }),
    useDeleteEvalCase: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
    useStartEvalBatch: () => ({ mutateAsync: startBatchMutateAsync, isPending: false }),
    useCreateEvalCase: () => ({ mutateAsync: createMutateAsync, isPending: false }),
    useUpdateEvalCase: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  };
});

let runningIds: () => string[] = () => [];
let batchesState: { data?: EvalBatchRecord[] } = {};
let activeBatchState: { data?: EvalBatchDetail } = {};

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  runningIds = () => [];
  batchesState = {};
  activeBatchState = {};
  casesSpy.mockReset();
  runMutateAsync.mockReset();
  deleteMutateAsync.mockReset();
  startBatchMutateAsync.mockReset();
  createMutateAsync.mockReset();
  updateMutateAsync.mockReset();
});

const SKILL: Skill = {
  id: "skill-1",
  name: "no-hardcoded-secrets",
  description: "Flags hardcoded credentials",
  type: "rubric",
  source: "manual",
  body: "# No hardcoded secrets",
  enabled: true,
  version: 1,
  evidence_files: null,
};

/** Deliberately NOT in `name` order — proves the tab renders the server's
 * order verbatim rather than re-sorting (REQ-51). */
const CASE_B: EvalCaseListItem = {
  id: "case-b",
  owner_kind: "skill",
  owner_id: "skill-1",
  name: "b-stripe-key",
  expectation_kind: "must_find",
  input_diff: "--- a/snippet.ts\n+++ b/snippet.ts",
  input_files: null,
  input_meta: null,
  expected_output: [
    { severity: "CRITICAL", category: "security", title: "Hardcoded key", start_line: 1, end_line: 1, file: "snippet.ts" },
  ],
  forbidden_regions: null,
  filename: "snippet.ts",
  notes: null,
  latest_run: {
    run_id: "run-1",
    case_id: "case-b",
    ran_at: "2026-08-20T00:00:00.000Z",
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    actual_output: {},
    ablation: {
      with: {
        recall: 1,
        precision: 1,
        citation_accuracy: 1,
        findings: [
          {
            id: "f-1",
            severity: "CRITICAL",
            category: "security",
            title: "Hardcoded key",
            file: "snippet.ts",
            start_line: 1,
            end_line: 1,
            rationale: "A live key is checked in.",
            confidence: 0.95,
          },
        ],
      },
      without: { recall: 0.5, findings: [] },
    },
    duration_ms: 1200,
    cost_usd: 0.01,
  },
};

const CASE_A: EvalCaseListItem = {
  id: "case-a",
  owner_kind: "skill",
  owner_id: "skill-1",
  name: "a-never-run",
  expectation_kind: "must_not_flag",
  input_diff: "--- a/snippet.ts\n+++ b/snippet.ts",
  input_files: null,
  input_meta: null,
  expected_output: [],
  forbidden_regions: null,
  filename: "snippet.ts",
  notes: null,
  latest_run: null,
};

function renderTab(skill: Skill = SKILL) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
      <ToastProvider>
        <EvalsTab skill={skill} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("REQ-51: renders the server's order verbatim, with header actions and Run/Edit/delete on every row", () => {
    casesSpy.mockReturnValue({ data: [CASE_B, CASE_A], isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    // Header actions.
    expect(screen.getByRole("button", { name: /Run all evals/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ New eval case" })).toBeInTheDocument();

    // Server order (b, a) — NOT alphabetical (a, b) — proves no client sort.
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("b-stripe-key")).toBeInTheDocument();
    expect(within(items[1]!).getByText("a-never-run")).toBeInTheDocument();

    // Every row carries Run, Edit and a delete control.
    for (const item of items) {
      // The row's Run now names its case (WCAG 2.5.3 disambiguation), so an
      // exact-name query would miss it — client/INSIGHTS.md 2026-08-29.
      expect(within(item).getByRole("button", { name: /^Run — / })).toBeInTheDocument();
      expect(within(item).getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(within(item).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    }
  });

  // Mutation this kills: gating a row on the shared mutation's `isPending`
  // (the old local `runningId`), which froze every other row for the whole
  // seconds-long request.
  it("a case running does not block the others: its own row says Running…, the rest stay clickable", () => {
    casesSpy.mockReturnValue({ data: [CASE_B, CASE_A], isLoading: false, isError: false, refetch: vi.fn() });
    runningIds = () => ["case-b"];
    renderTab();

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByRole("button", { name: /^Running… — b-stripe-key/ })).toBeDisabled();
    // The badge stops claiming the PREVIOUS verdict while the case re-runs.
    expect(within(items[0]!).queryByText("passed")).toBeNull();

    const other = within(items[1]!).getByRole("button", { name: /^Run — a-never-run/ });
    expect(other).toBeEnabled();
    fireEvent.click(other);
    expect(runMutateAsync).toHaveBeenCalledWith("case-a");
  });

  // Mutation this kills: rendering a batch's untouched cases as idle (or as
  // running). The server's pool is bounded, so a case it has not reached is
  // queued — and the progress line needs a real denominator, not `n/0`.
  it("a running batch labels the case in flight Running…, the overflow Queued, and shows scored/total", () => {
    casesSpy.mockReturnValue({ data: [CASE_B, CASE_A], isLoading: false, isError: false, refetch: vi.fn() });
    batchesState = { data: [{ id: "batch-1", status: "running" } as EvalBatchRecord] };
    activeBatchState = {
      data: { id: "batch-1", status: "running", cases_total: 0, cases: [] } as unknown as EvalBatchDetail,
    };
    renderTab();

    // `cases_total: 0` is what a batch started before the server fix reports —
    // the list's own count stands in, so the line never reads `0/0`.
    // Queried by text, not by role: the `Badge`s on the rows are status roles
    // too, so `getByRole("status")` is ambiguous here.
    expect(screen.getByText(/Running… 0\/2/)).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByRole("button", { name: /^Running… — b-stripe-key/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Running….*already running/i })).toBeDisabled();
  });

  it("a batch runs at most EVAL_BATCH_CONCURRENCY cases at once: the overflow reads Queued and cannot be clicked", () => {
    // Five cases against a pool of three, so the cap is actually exercised —
    // the two-case fixture above can never show a queued row. The bound is
    // IMPORTED, not hardcoded: marking more rows "running" than the server's
    // pool can hold would claim LLM calls that are not happening, and this
    // assertion must move with the constant if it ever changes.
    const many = Array.from({ length: EVAL_BATCH_CONCURRENCY + 2 }, (_, i) => ({
      ...CASE_A,
      id: `case-${i}`,
      name: `case-${i}`,
    }));
    casesSpy.mockReturnValue({ data: many, isLoading: false, isError: false, refetch: vi.fn() });
    batchesState = { data: [{ id: "batch-1", status: "running" } as EvalBatchRecord] };
    activeBatchState = {
      data: { id: "batch-1", status: "running", cases_total: many.length, cases: [] } as unknown as EvalBatchDetail,
    };
    renderTab();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(EVAL_BATCH_CONCURRENCY + 2);

    const running = items.filter((li) => within(li).queryByRole("img", { name: "Running…" }));
    const queued = items.filter((li) => within(li).queryByRole("img", { name: "Queued" }));
    expect(running).toHaveLength(EVAL_BATCH_CONCURRENCY);
    expect(queued).toHaveLength(2);

    // A queued row is not merely labelled — its Run is inert, because the
    // server has no live call for it to interrupt.
    expect(within(queued[0]!).getByRole("button", { name: /^Queued — / })).toBeDisabled();
  });

  it("REQ-8: a case with a run shows the pass/fail marker and the finding count; a never-run case shows the neutral marker", () => {
    casesSpy.mockReturnValue({ data: [CASE_B, CASE_A], isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    const items = screen.getAllByRole("listitem");
    // The verdict is an ICON with an accessible name, not visible text — the
    // agent tab's anatomy (owner decision, 2026-08-29), so it is queried by
    // role+name rather than by `getByText`.
    expect(within(items[0]!).getByRole("img", { name: "passed" })).toBeInTheDocument();
    // REQ-8's `got <m>` for a SKILL case counts the WITH arm's findings, not
    // `actual_output` (which holds the `{with, without}` ablation object).
    // CASE_B's with arm has one finding and its without arm scored 0.5.
    expect(
      within(items[0]!).getByText(
        "expected 1 finding, got 1 · recall 100% · With skill 100% / Without skill 50%",
      ),
    ).toBeInTheDocument();

    // A never-run case: neutral marker (accessible name) plus the result line.
    expect(within(items[1]!).getByRole("img", { name: "never run" })).toBeInTheDocument();
    expect(within(items[1]!).getByText("never run")).toBeInTheDocument();
  });

  it("states what each case ASSERTS: MUST FIND beside a case with expectations, MUST NOT FLAG beside an empty one", () => {
    casesSpy.mockReturnValue({ data: [CASE_B, CASE_A], isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("Must find")).toBeInTheDocument();
    // Severity/category metadata is read off the first expectation, and only a
    // case that HAS one renders it.
    expect(within(items[0]!).getByText(/CRITICAL/)).toBeInTheDocument();

    expect(within(items[1]!).getByText("Must not flag")).toBeInTheDocument();
    expect(within(items[1]!).queryByText(/CRITICAL|WARNING|SUGGESTION/)).toBeNull();
  });

  it("a single-case run leaves the without arm unmeasured, and the row renders an em dash for it rather than 0%", () => {
    const notRun: EvalCaseListItem = {
      ...CASE_B,
      latest_run: {
        ...CASE_B.latest_run!,
        ablation: { with: { recall: 1, precision: 1, citation_accuracy: 1, findings: [] }, without: { unavailable: "not_run" } },
      },
    };
    casesSpy.mockReturnValue({ data: [notRun], isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    expect(
      screen.getByText("expected 1 finding, got 0 · recall 100% · With skill 100% / Without skill —"),
    ).toBeInTheDocument();
  });

  it("renders no metric cards, deltas, alert banner, trend chart or batch history", () => {
    casesSpy.mockReturnValue({ data: [CASE_B, CASE_A], isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    expect(screen.queryByText(/Eval metrics/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Metric trend/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Recent runs/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // No trend chart. Asserted against Recharts' own wrapper rather than
    // `queryByRole("img")` — every row's status marker is now a `role="img"`
    // icon, so the blanket query no longer isolates a chart. Recharts renders
    // 0x0 under jsdom (client/INSIGHTS.md 2026-08-29), so its wrapper element
    // is the only reliable witness either way.
    expect(document.querySelector(".recharts-wrapper")).toBeNull();
  });

  it("REQ-51/empty: a skill with zero cases renders the empty state with + New eval case, and it opens the shared editor", () => {
    casesSpy.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    const cta = screen.getAllByRole("button", { name: "+ New eval case" });
    expect(cta.length).toBeGreaterThan(0);

    fireEvent.click(cta[0]!);
    const dialog = screen.getByRole("dialog");
    // T14's real EvalCaseEditor, not a stub or a fork — its own "new case"
    // title only renders from that component.
    expect(within(dialog).getByText("New eval case")).toBeInTheDocument();
  });

  it("AC-68: a skill with no linked agent (or only disabled ones) renders Run all evals enabled, and activating it posts the batch", async () => {
    casesSpy.mockReturnValue({ data: [CASE_B], isLoading: false, isError: false, refetch: vi.fn() });
    startBatchMutateAsync.mockResolvedValue({});
    renderTab();

    const runAll = screen.getByRole("button", { name: "Run all evals" });
    expect(runAll).toBeEnabled();
    // No control anywhere states that a linked or enabled agent is required.
    expect(screen.queryByText(/agent/i)).not.toBeInTheDocument();

    fireEvent.click(runAll);
    expect(startBatchMutateAsync).toHaveBeenCalledWith({ owner_kind: "skill", owner_id: "skill-1" });
  });

  it("AC-15: a skill with zero cases still renders Run all evals disabled with its accessible reason", () => {
    casesSpy.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    const runAll = screen.getByRole("button", { name: /Run all evals/ });
    expect(runAll).toBeDisabled();
    expect(runAll).toHaveAccessibleName(/Run all evals — .+/);
    expect(startBatchMutateAsync).not.toHaveBeenCalled();
  });

  it("+ New eval case and a row's Edit both open EvalCaseEditor in skill mode, imported from components/eval-case-editor", () => {
    casesSpy.mockReturnValue({ data: [CASE_B, CASE_A], isLoading: false, isError: false, refetch: vi.fn() });
    renderTab();

    // Row Edit opens the editor seeded with that case's name.
    const items = screen.getAllByRole("listitem");
    fireEvent.click(within(items[0]!).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("b-stripe-key")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Header "+ New eval case" opens a blank editor.
    fireEvent.click(screen.getByRole("button", { name: "+ New eval case" }));
    const newDialog = screen.getByRole("dialog");
    expect(within(newDialog).getByText("New eval case")).toBeInTheDocument();
  });

  it("REQ-52: TABS gains exactly one entry, Evals, after Versions; Stats does not appear", async () => {
    const { TABS, VALID_TABS } = await import("../../constants");
    const keys = TABS.map((tb) => tb.key);
    expect(keys).toEqual(["config", "preview", "context", "versions", "evals"]);
    expect(keys).not.toContain("stats");
    expect(VALID_TABS).toContain("evals");
  });
});
