import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import type { EvalRunRecord } from "@devdigest/shared/contracts/eval-ci";
import type { EvalCase } from "@devdigest/shared/contracts/knowledge";
import messages from "../../../../../../../../messages/en/eval.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const startRunMutate = vi.fn();
const deleteCaseMutate = vi.fn();
const createCaseMutate = vi.fn();
const successToast = vi.fn();

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: successToast, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

let CASES: EvalCase[] = [];
let RUNS: EvalRunRecord[] = [];

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: CASES, isLoading: false }),
  useEvalRuns: () => ({ data: RUNS }),
  useEvalRun: () => ({ data: undefined }),
  useStartEvalRun: () => ({ mutate: startRunMutate, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: deleteCaseMutate }),
  useEvalCase: () => ({ data: undefined, isLoading: true }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEvalCase: () => ({ mutate: createCaseMutate, isPending: false }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const AGENT: Agent = {
  id: "agent-1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "Review.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function evalCase(id: string, name: string, type: "must_find" | "must_not_flag" = "must_find"): EvalCase {
  return {
    id,
    owner_kind: "agent",
    owner_id: "agent-1",
    name,
    input_diff: "diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,2 @@\n-a\n+b\n",
    input_files: ["src/x.ts"],
    input_meta: { pr_number: 491, title: "Fix auth", body: null },
    expectation: { type, file: "src/x.ts", start_line: 1, end_line: 1, severity: "CRITICAL", category: "security", title: "x" },
    source_finding_id: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab", () => {
  it("shows the empty-cases state with no metric values when the agent has no cases (AC-46)", () => {
    CASES = [];
    RUNS = [];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText(messages.empty.noCases)).toBeInTheDocument();
    expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
  });

  it("shows the never-run message when cases exist but no run has completed (AC-47)", () => {
    CASES = [evalCase("c1", "stripe-key-leak")];
    RUNS = [];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getByText(evalCase("c1", "stripe-key-leak").name)).toBeInTheDocument();
    expect(screen.getByText(messages.empty.neverRun)).toBeInTheDocument();
  });

  it("renders the metric tiles, case list and run history together (AC-37)", () => {
    CASES = [evalCase("c1", "stripe-key-leak")];
    RUNS = [
      {
        id: "run-1",
        owner_kind: "agent",
        owner_id: "agent-1",
        agent_name: "Security Reviewer",
        status: "completed",
        started_at: "2026-01-01T00:00:00.000Z",
        finished_at: "2026-01-01T00:01:00.000Z",
        agent_version: 1,
        case_ids: ["c1"],
        metrics: {
          recall: 1,
          precision: 1,
          citation_accuracy: 1,
          traces_passed: 1,
          traces_total: 1,
          cases_errored: 0,
          duration_ms: 1000,
          cost_usd: 0.01,
          per_case: [
            {
              case_id: "c1",
              name: "stripe-key-leak",
              expectation_type: "must_find",
              status: "scored",
              pass: true,
              error_reason: null,
              findings_total: 1,
              findings_matched: 1,
              grounding_kept: 1,
              grounding_total: 1,
              duration_ms: 500,
              cost_usd: 0.01,
              actual: [],
            },
          ],
        },
        duration_ms: 1000,
        cost_usd: 0.01,
        error_reason: null,
      },
    ];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    expect(screen.getAllByText("100%").length).toBeGreaterThan(0);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText(messages.evalsTab.passed)).toBeInTheDocument();
  });

  it("starts a run when the Run button is clicked", () => {
    CASES = [evalCase("c1", "stripe-key-leak")];
    RUNS = [];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    fireEvent.click(screen.getByRole("button", { name: /run eval/i }));
    expect(startRunMutate).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("confirms before deleting a case", () => {
    CASES = [evalCase("c1", "stripe-key-leak")];
    RUNS = [];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithIntl(<EvalsTab agent={AGENT} />);
    fireEvent.click(screen.getByRole("button", { name: messages.evalsTab.delete }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteCaseMutate).toHaveBeenCalledWith({ id: "c1", ownerId: "agent-1" });
    confirmSpy.mockRestore();
  });

  it("opens the new-case modal and submits a hand-authored case owned by this agent", () => {
    CASES = [];
    RUNS = [];
    renderWithIntl(<EvalsTab agent={AGENT} />);
    fireEvent.click(screen.getByRole("button", { name: messages.caseEditor.newCase }));

    const nameInput = document.getElementById("agent-new-case-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "hand-authored-case" } });
    fireEvent.click(screen.getByRole("button", { name: messages.caseEditor.save }));

    expect(createCaseMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        input: expect.objectContaining({ name: "hand-authored-case" }),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});
