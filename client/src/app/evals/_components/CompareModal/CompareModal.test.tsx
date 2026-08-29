import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalBatchComparison } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import commonMessages from "../../../../../messages/en/common.json";
import skillsMessages from "../../../../../messages/en/skills.json";
import runsMessages from "../../../../../messages/en/runs.json";
import agentsMessages from "../../../../../messages/en/agents.json";

let compareState: {
  data?: EvalBatchComparison;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: true, isError: false };

vi.mock("@/lib/hooks/evals", () => ({
  useEvalBatchComparison: () => ({ ...compareState, refetch: vi.fn() }),
}));

/* The restore hooks and the owner queries all call `useQueryClient`, which
   throws before it ever looks at `enabled` — mocking them is what keeps this
   suite provider-free, the same trap the 2026-08-29 insight records. */
const restoreAgent = vi.fn();
const restoreSkill = vi.fn();
let agentVersion: number | undefined = 9;
let skillVersion: number | undefined = 9;

vi.mock("@/lib/hooks/agents", () => ({
  useAgent: (id: string | null) => ({ data: id ? { id, version: agentVersion } : undefined }),
  useRestoreAgentVersion: () => ({ mutateAsync: restoreAgent, isPending: false }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkill: (id: string | null) => ({ data: id ? { id, version: skillVersion } : undefined }),
  useRestoreSkillVersion: () => ({ mutateAsync: restoreSkill, isPending: false }),
}));

const toast = { success: vi.fn(), info: vi.fn(), error: vi.fn() };
vi.mock("@/lib/toast", () => ({ useToast: () => toast }));

import { CompareModal } from "./CompareModal";

function batch(over: Partial<EvalBatchComparison["older"]> = {}): EvalBatchComparison["older"] {
  return {
    id: "b1",
    owner_kind: "agent",
    owner_id: "a1",
    owner_version: 6,
    runner_agent_id: null,
    runner_agent_version: null,
    started_at: "2026-05-27T16:40:00.000Z",
    finished_at: "2026-05-27T16:41:00.000Z",
    status: "succeeded",
    recall: 0.78,
    precision: 0.93,
    citation_accuracy: 0.94,
    cases_passed: 16,
    cases_total: 20,
    cost_usd: 0.21,
    ...over,
  };
}

function comparison(over: Partial<EvalBatchComparison> = {}): EvalBatchComparison {
  return {
    older: batch({ owner_version: 6 }),
    newer: batch({ owner_version: 7, recall: 0.82, precision: 0.91, citation_accuracy: 0.95, cost_usd: 0.23 }),
    recall: { old: 0.78, new: 0.82, delta: 0.04 },
    precision: { old: 0.93, new: 0.91, delta: -0.02 },
    citation_accuracy: { old: 0.94, new: 0.95, delta: 0.01 },
    cost_usd: { old: 0.21, new: 0.23, delta: 0.02 },
    same_version: false,
    prompt_diff: [
      { op: "same", text: "You are a security-focused PR reviewer." },
      { op: "del", text: "Return at most 3 findings." },
      { op: "add", text: "Return at most 5 findings ranked by severity." },
    ],
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  compareState = { data: undefined, isLoading: true, isError: false };
  agentVersion = 9;
  skillVersion = 9;
});

function renderModal() {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        eval: evalMessages,
        common: commonMessages,
        skills: skillsMessages,
        runs: runsMessages,
        agents: agentsMessages,
      }}
    >
      <CompareModal batchA="b1" batchB="b2" onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("CompareModal", () => {
  it("renders four delta cards in RECALL, PRECISION, CITATION, COST order with old → new and a signed delta", () => {
    compareState = { data: comparison(), isLoading: false, isError: false };
    renderModal();

    const dialog = screen.getByRole("dialog");
    const labels = within(dialog)
      .getAllByText(/^(RECALL|PRECISION|CITATION|COST)$/)
      .map((el) => el.textContent);
    expect(labels).toEqual(["RECALL", "PRECISION", "CITATION", "COST"]);

    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("+4%")).toBeInTheDocument();
    expect(screen.getByText("-2%")).toBeInTheDocument();
    expect(screen.getByText("$0.21")).toBeInTheDocument();
    expect(screen.getByText("$0.23")).toBeInTheDocument();
    expect(screen.getByText("+$0.02")).toBeInTheDocument();
  });

  it("keeps every metric value on one line — no wrap inside a delta card", () => {
    compareState = { data: comparison(), isLoading: false, isError: false };
    renderModal();

    // The reported bug: at four fixed columns the `old → new` row broke onto
    // extra lines. `nowrap` on the row plus `flexShrink: 0` on its children is
    // what prevents it, so assert the declarations rather than a layout jsdom
    // cannot compute.
    const oldValue = screen.getByText("78%");
    const row = oldValue.parentElement!;
    expect(row.style.whiteSpace).toBe("nowrap");
    expect(oldValue.style.flexShrink).toBe("0");
    expect(screen.getByText("82%").style.flexShrink).toBe("0");
    expect(screen.getByText("CITATION").style.whiteSpace).toBe("nowrap");
  });

  it("renders the served prompt diff as add/del/same lines with gutter numbers and a hunk header", () => {
    compareState = { data: comparison(), isLoading: false, isError: false };
    renderModal();

    expect(screen.getByText("Return at most 3 findings.")).toBeInTheDocument();
    expect(screen.getByText("Return at most 5 findings ranked by severity.")).toBeInTheDocument();
    expect(screen.getByText("You are a security-focused PR reviewer.")).toBeInTheDocument();

    // Old side is lines 1-2 (same + del), new side is 1-2 (same + add).
    expect(screen.getByText("@@ -1,2 +1,2 @@")).toBeInTheDocument();
    const gutters = screen.getAllByText(/^[0-9]+$/).map((el) => el.textContent);
    expect(gutters).toEqual(["1", "2", "2"]);
  });

  it("labels the diff and legends it with the two versions", () => {
    compareState = { data: comparison(), isLoading: false, isError: false };
    renderModal();

    expect(screen.getByText(/System prompt diff/i)).toBeInTheDocument();
    expect(screen.getByText(/v6 \(old\)/)).toBeInTheDocument();
    expect(screen.getByText(/v7 \(new\)/)).toBeInTheDocument();
    expect(screen.getByText("Metric deltas and prompt diff on the gold set")).toBeInTheDocument();
  });

  it("renders a same-version statement instead of an empty diff pane when owner_version matches", () => {
    compareState = {
      data: comparison({ same_version: true, prompt_diff: null }),
      isLoading: false,
      isError: false,
    };
    renderModal();

    expect(screen.getByText(/same prompt version/i)).toBeInTheDocument();
    // Nothing to choose between, so the promote is off.
    expect(screen.getByRole("button", { name: /^Promote v7/ })).toBeDisabled();
  });

  it("promotes the NEWER version through the agent restore hook, after a confirmation", async () => {
    compareState = { data: comparison(), isLoading: false, isError: false };
    restoreAgent.mockResolvedValue({ id: "a1", version: 10 });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /^Promote v7/ }));
    // Arming replaces the footer; the write has not fired yet.
    expect(restoreAgent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));

    await waitFor(() => expect(restoreAgent).toHaveBeenCalledWith({ id: "a1", version: 7 }));
    expect(restoreSkill).not.toHaveBeenCalled();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Promoted v7 as v10."));
  });

  it("routes a skill-owned batch to the skill restore hook", async () => {
    compareState = {
      data: comparison({
        older: batch({ owner_kind: "skill", owner_id: "s1", owner_version: 6 }),
        newer: batch({ owner_kind: "skill", owner_id: "s1", owner_version: 7 }),
      }),
      isLoading: false,
      isError: false,
    };
    restoreSkill.mockResolvedValue({ id: "s1", version: 10 });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /^Promote v7/ }));
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));

    await waitFor(() => expect(restoreSkill).toHaveBeenCalledWith({ id: "s1", version: 7 }));
    expect(restoreAgent).not.toHaveBeenCalled();
  });

  it("reports a server no-op as such instead of claiming a version that was never written", async () => {
    compareState = { data: comparison(), isLoading: false, isError: false };
    // Owner is already at v9 and the restore changed nothing, so the endpoint
    // answers 200 with the UNCHANGED entity. Comparing the response to the
    // target (7) would misread this as a successful promote.
    agentVersion = 9;
    restoreAgent.mockResolvedValue({ id: "a1", version: 9 });
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /^Promote v7/ }));
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));

    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("surfaces a failed promote as a toast and unwinds the confirmation", async () => {
    compareState = { data: comparison(), isLoading: false, isError: false };
    restoreAgent.mockRejectedValue(new Error("boom"));
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /^Promote v7/ }));
    fireEvent.click(screen.getByRole("button", { name: "Promote" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Back to the resting footer, not stuck mid-confirm.
    expect(screen.getByRole("button", { name: /^Promote v7/ })).toBeInTheDocument();
  });

  it("offers no promote while the comparison is still loading", () => {
    compareState = { data: undefined, isLoading: true, isError: false };
    renderModal();
    expect(screen.queryByRole("button", { name: /^Promote/ })).not.toBeInTheDocument();
  });
});
