import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatch, EvalBatchCompareResult } from "@devdigest/shared";
import evalsMessages from "../../../../messages/en/evals.json";
import agentsMessages from "../../../../messages/en/agents.json";

// ---- Mocks -----------------------------------------------------------------

let compareResult: EvalBatchCompareResult | undefined;
const promoteMutate = vi.fn();
let promoteIsPending = false;

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCompare: () => ({ data: compareResult, isLoading: false }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  usePromoteAgentPrompt: () => ({ mutate: promoteMutate, isPending: promoteIsPending }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn(), toast: vi.fn() }),
}));

import { CompareModal } from "./CompareModal";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evals: evalsMessages, agents: agentsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function makeBatchDetail(overrides: Partial<EvalBatchCompareResult["a"]> = {}): EvalBatchCompareResult["a"] {
  return {
    id: "b1",
    agent_id: "ag1",
    kind: "full",
    status: "clean",
    agent_snapshot: {},
    recall: 0.9,
    precision: 0.85,
    citation_accuracy: 0.95,
    cost_usd: 0.02,
    ran_at: "2026-07-01T00:00:00.000Z",
    system_prompt_snapshot: "You are a strict reviewer.",
    cases: [],
    excluded_skill_owned_count: 0,
    ...overrides,
  };
}

function makeBatch(overrides: Partial<EvalBatch> = {}): EvalBatch {
  return {
    id: "b1",
    agent_id: "ag1",
    kind: "full",
    status: "clean",
    agent_snapshot: {},
    recall: 0.9,
    precision: 0.85,
    citation_accuracy: 0.95,
    cost_usd: 0.02,
    ran_at: "2026-07-01T00:00:00.000Z",
    system_prompt_snapshot: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  compareResult = undefined;
  promoteMutate.mockClear();
  promoteIsPending = false;
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("CompareModal", () => {
  it("hides the prompt-diff toggle and shows an explanatory note when prompt_diff_available is false", () => {
    compareResult = {
      a: makeBatchDetail({ id: "b1", system_prompt_snapshot: null, ran_at: "2026-07-01T00:00:00.000Z" }),
      b: makeBatchDetail({ id: "b2", system_prompt_snapshot: "You are a lenient reviewer.", ran_at: "2026-07-02T00:00:00.000Z" }),
      deltas: { recall: 0, precision: 0, citation_accuracy: 0, cost_usd: 0 },
      prompt_diff_available: false,
    };
    const batches = [makeBatch({ id: "b1" }), makeBatch({ id: "b2", ran_at: "2026-07-02T00:00:00.000Z" })];

    renderWithIntl(
      <CompareModal agentId="ag1" batchIdA="b1" batchIdB="b2" batches={batches} onClose={vi.fn()} />,
    );

    // Older batch (b1) has no snapshot but the newer (b2) does → the modal
    // shows the newer prompt verbatim with an explanatory note, and never a
    // word-diff.
    expect(screen.getByText(/predates prompt tracking/i)).toBeInTheDocument();
    expect(screen.getByText(/lenient/)).toBeInTheDocument();
  });

  it("disables the Promote button when the newer batch has no prompt snapshot (AC-22)", () => {
    // Newer batch (b2, later ran_at) has a null snapshot — Promote must be
    // disabled even though the metrics comparison itself still renders.
    compareResult = {
      a: makeBatchDetail({ id: "b1", system_prompt_snapshot: "You are a strict reviewer.", ran_at: "2026-07-01T00:00:00.000Z" }),
      b: makeBatchDetail({ id: "b2", system_prompt_snapshot: null, ran_at: "2026-07-02T00:00:00.000Z" }),
      deltas: { recall: 0.1, precision: 0.05, citation_accuracy: 0.02, cost_usd: 0.01 },
      prompt_diff_available: false,
    };
    const batches = [makeBatch({ id: "b1" }), makeBatch({ id: "b2", ran_at: "2026-07-02T00:00:00.000Z" })];

    renderWithIntl(
      <CompareModal agentId="ag1" batchIdA="b1" batchIdB="b2" batches={batches} onClose={vi.fn()} />,
    );

    const promoteBtn = screen.getByRole("button", { name: /promote/i });
    expect(promoteBtn).toBeDisabled();
    expect(screen.getByText(/no stored prompt text/i)).toBeInTheDocument();
  });

  it("keeps Promote enabled when only the OLDER batch lacks a snapshot (metrics-only compare still allowed)", () => {
    // The older batch (b1) has no snapshot, but the newer one (b2) does —
    // `prompt_diff_available` is false (it requires BOTH sides), yet Promote
    // must stay enabled because it only cares about the NEWER batch.
    compareResult = {
      a: makeBatchDetail({ id: "b1", system_prompt_snapshot: null, ran_at: "2026-07-01T00:00:00.000Z" }),
      b: makeBatchDetail({ id: "b2", system_prompt_snapshot: "You are a lenient reviewer.", ran_at: "2026-07-02T00:00:00.000Z" }),
      deltas: { recall: 0.1, precision: 0.05, citation_accuracy: 0.02, cost_usd: 0.01 },
      prompt_diff_available: false,
    };
    const batches = [makeBatch({ id: "b1" }), makeBatch({ id: "b2", ran_at: "2026-07-02T00:00:00.000Z" })];

    renderWithIntl(
      <CompareModal agentId="ag1" batchIdA="b1" batchIdB="b2" batches={batches} onClose={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: /promote/i })).toBeEnabled();
    expect(screen.queryByText(/no stored prompt text/i)).not.toBeInTheDocument();
  });

  it("a successful promote shows a confirmation and closes the modal (AC-21)", async () => {
    compareResult = {
      a: makeBatchDetail({ id: "b1", system_prompt_snapshot: "You are a strict reviewer.", ran_at: "2026-07-01T00:00:00.000Z" }),
      b: makeBatchDetail({ id: "b2", system_prompt_snapshot: "You are a lenient reviewer.", ran_at: "2026-07-02T00:00:00.000Z" }),
      deltas: { recall: 0.1, precision: 0.05, citation_accuracy: 0.02, cost_usd: 0.01 },
      prompt_diff_available: true,
    };
    const batches = [makeBatch({ id: "b1" }), makeBatch({ id: "b2", ran_at: "2026-07-02T00:00:00.000Z" })];
    const onClose = vi.fn();

    promoteMutate.mockImplementation((_batchId: string, opts?: { onSuccess?: (agent: { version: number }) => void }) => {
      opts?.onSuccess?.({ version: 2 });
    });

    const user = userEvent.setup();
    renderWithIntl(
      <CompareModal agentId="ag1" batchIdA="b1" batchIdB="b2" batches={batches} onClose={onClose} />,
    );

    const promoteBtn = screen.getByRole("button", { name: /promote/i });
    expect(promoteBtn).toBeEnabled();
    await user.click(promoteBtn);

    expect(promoteMutate).toHaveBeenCalledWith("b2", expect.anything());
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders a word-level diff (removed/added spans) when prompt_diff_available is true", () => {
    compareResult = {
      a: makeBatchDetail({ id: "b1", system_prompt_snapshot: "You are a strict reviewer.", ran_at: "2026-07-01T00:00:00.000Z" }),
      b: makeBatchDetail({ id: "b2", system_prompt_snapshot: "You are a lenient reviewer.", ran_at: "2026-07-02T00:00:00.000Z" }),
      deltas: { recall: 0.1, precision: 0.05, citation_accuracy: 0.02, cost_usd: 0.01 },
      prompt_diff_available: true,
    };
    // The prompt-version map is derived from the full batch history's stored
    // snapshots — two DIFFERENT prompts → prompt v1 (older) and prompt v2.
    const batches = [
      makeBatch({ id: "b1", system_prompt_snapshot: "You are a strict reviewer.", ran_at: "2026-07-01T00:00:00.000Z" }),
      makeBatch({ id: "b2", system_prompt_snapshot: "You are a lenient reviewer.", ran_at: "2026-07-02T00:00:00.000Z" }),
    ];

    renderWithIntl(
      <CompareModal agentId="ag1" batchIdA="b1" batchIdB="b2" batches={batches} onClose={vi.fn()} />,
    );

    expect(screen.getByText("strict")).toBeInTheDocument();
    expect(screen.getByText("lenient")).toBeInTheDocument();
    // Title + legend both read PROMPT versions (bump only on a real text change).
    expect(screen.getByText("Compare runs · v1 → v2")).toBeInTheDocument();
    expect(screen.getByText("prompt v1 (old)")).toBeInTheDocument();
    expect(screen.getByText("prompt v2 (new)")).toBeInTheDocument();
  });

  it("shows a single prompt version (no bump) when the same prompt ran twice (unchanged)", () => {
    const SAME = "You are a strict reviewer.";
    compareResult = {
      a: makeBatchDetail({ id: "b1", system_prompt_snapshot: SAME, ran_at: "2026-07-01T00:00:00.000Z" }),
      b: makeBatchDetail({ id: "b2", system_prompt_snapshot: SAME, ran_at: "2026-07-02T00:00:00.000Z" }),
      deltas: { recall: 0, precision: 0, citation_accuracy: 0, cost_usd: 0 },
      prompt_diff_available: true,
    };
    const batches = [
      makeBatch({ id: "b1", system_prompt_snapshot: SAME, ran_at: "2026-07-01T00:00:00.000Z" }),
      makeBatch({ id: "b2", system_prompt_snapshot: SAME, ran_at: "2026-07-02T00:00:00.000Z" }),
    ];

    renderWithIntl(
      <CompareModal agentId="ag1" batchIdA="b1" batchIdB="b2" batches={batches} onClose={vi.fn()} />,
    );

    // Two RUNS on an unchanged prompt → still prompt v1, no "v2" prompt bump.
    // The title compares by prompt version too, so it reads "v1 → v1" (decision:
    // vN is the prompt version everywhere, never a per-run ordinal).
    expect(screen.getByText("Compare runs · v1 → v1")).toBeInTheDocument();
    expect(screen.getByText(/still prompt v1/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Promote prompt v1" })).toBeInTheDocument();
  });
});
