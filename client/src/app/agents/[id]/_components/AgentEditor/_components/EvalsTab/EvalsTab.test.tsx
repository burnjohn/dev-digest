/* EvalsTab.test.tsx — RTL unit tests for the AgentEditor Evals tab (T9).
   Acceptance checks:
   - Tab lists eval cases with a textual pass/fail label (not color-only, a11y).
   - Run-all button triggers the run mutation.
   - Empty set renders the empty state (not case rows or 0-metrics).

   All network/hooks are mocked — no QueryClient or server needed. */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import evalMessages from "../../../../../../../../messages/en/eval.json";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

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
  version: 3,
};

const CASE_1 = {
  id: "case-1",
  owner_kind: "agent" as const,
  owner_id: "ag1",
  name: "stripe-key-leak",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n",
  input_files: null,
  input_meta: null,
  expected_output: { type: "must_find", findings: [] },
  notes: "Must flag hardcoded API key",
};

const CASE_2 = {
  id: "case-2",
  owner_kind: "agent" as const,
  owner_id: "ag1",
  name: "no-fp-on-test-files",
  input_diff: "--- a/tests/config.test.ts\n+++ b/tests/config.test.ts\n",
  input_files: null,
  input_meta: null,
  expected_output: { type: "must_not_flag", findings: [], forbidden: [{ file: "tests/config.test.ts", start_line: 1, end_line: 10 }] },
  notes: null,
};

// ---------------------------------------------------------------------------
// Hook mocks — set up before the component import (vi.mock hoisting)
// ---------------------------------------------------------------------------

const mockRunMutate = vi.fn();
const mockDeleteMutate = vi.fn();

const useEvalCasesMock = vi.fn();
const useRunAgentEvalsMock = vi.fn();
const useDeleteEvalCaseMock = vi.fn();

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: (id: unknown) => useEvalCasesMock(id),
  useRunAgentEvals: () => useRunAgentEvalsMock(),
  useDeleteEvalCase: () => useDeleteEvalCaseMock(),
}));

import { EvalsTab } from "./EvalsTab";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setupDefaultMocks(overrides?: {
  cases?: typeof CASE_1[];
  runPending?: boolean;
}) {
  const cases = overrides?.cases ?? [CASE_1, CASE_2];
  const runPending = overrides?.runPending ?? false;

  useEvalCasesMock.mockReturnValue({
    data: cases,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });

  useRunAgentEvalsMock.mockReturnValue({
    mutate: mockRunMutate,
    isPending: runPending,
  });

  useDeleteEvalCaseMock.mockReturnValue({
    mutate: mockDeleteMutate,
    isPending: false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EvalsTab", () => {
  it("renders the list of eval cases by name", () => {
    setupDefaultMocks();

    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText("no-fp-on-test-files")).toBeInTheDocument();
  });

  it("shows 'never run' label for all cases before any run (a11y — textual, not color-only)", () => {
    setupDefaultMocks();

    renderWithIntl(<EvalsTab agent={AGENT} />);

    // Both cases should show "never run" before a run is triggered.
    const neverRunLabels = screen.getAllByText("never run");
    expect(neverRunLabels.length).toBe(2);
  });

  it("shows textual 'passed' label after a run with a passing case result", () => {
    setupDefaultMocks();

    // Capture the mutate callback so we can invoke onSuccess manually.
    let capturedOnSuccess: ((data: unknown) => void) | undefined;
    useRunAgentEvalsMock.mockReturnValue({
      mutate: (_args: unknown, options?: { onSuccess?: (data: unknown) => void }) => {
        capturedOnSuccess = options?.onSuccess;
        mockRunMutate(_args, options);
      },
      isPending: false,
    });

    renderWithIntl(<EvalsTab agent={AGENT} />);

    // Click Run
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    // Simulate a successful run result where case-1 passed, case-2 failed.
    // Wrap in act() so the setLastRunResults state update is flushed before asserting.
    act(() => {
      capturedOnSuccess?.({
        group: {
          id: "grp-1",
          workspace_id: "ws1",
          owner_kind: "agent",
          owner_id: "ag1",
          agent_version: 3,
          label: null,
          ran_at: new Date().toISOString(),
          recall: 0.5,
          precision: 0.5,
          citation_accuracy: 0.5,
          total_cost_usd: null,
        },
        results: [
          {
            run_id: "run-1",
            case_id: "case-1",
            result: {
              recall: 1,
              precision: 1,
              citation_accuracy: 1,
              traces_passed: 1,
              traces_total: 1,
              duration_ms: 500,
              cost_usd: null,
              per_trace: [{ name: "stripe-key-leak", pass: true, expected: null, actual: null }],
            },
          },
          {
            run_id: "run-2",
            case_id: "case-2",
            result: {
              recall: 0,
              precision: 0,
              citation_accuracy: 0,
              traces_passed: 0,
              traces_total: 1,
              duration_ms: 450,
              cost_usd: null,
              per_trace: [{ name: "no-fp-on-test-files", pass: false, expected: null, actual: null }],
            },
          },
        ],
      });
    });

    // After the run: case-1 "passed", case-2 "failed" — textual labels, not color-only.
    expect(screen.getByText("passed")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
    // "never run" should be gone.
    expect(screen.queryByText("never run")).not.toBeInTheDocument();
  });

  it("shows the Run-all button and triggers the run mutation when clicked", () => {
    setupDefaultMocks();

    renderWithIntl(<EvalsTab agent={AGENT} />);

    const runBtn = screen.getByRole("button", { name: /run/i });
    expect(runBtn).toBeInTheDocument();
    fireEvent.click(runBtn);

    expect(mockRunMutate).toHaveBeenCalledWith(
      { agentId: "ag1" },
      expect.any(Object),
    );
  });

  it("disables the Run-all button while a run is in progress", () => {
    setupDefaultMocks({ runPending: true });

    renderWithIntl(<EvalsTab agent={AGENT} />);

    // The Run button is rendered as disabled while isPending.
    const runBtn = screen.getByRole("button", { name: /running/i });
    expect(runBtn).toBeDisabled();
  });

  it("renders the empty state when the agent has zero eval cases", () => {
    setupDefaultMocks({ cases: [] });

    renderWithIntl(<EvalsTab agent={AGENT} />);

    // Empty state renders — case list does not.
    expect(screen.getByText("No eval cases yet")).toBeInTheDocument();
    expect(screen.queryByText("stripe-key-leak")).not.toBeInTheDocument();
  });

  it("the Run-all button is disabled when there are no cases", () => {
    setupDefaultMocks({ cases: [] });

    renderWithIntl(<EvalsTab agent={AGENT} />);

    const runBtn = screen.getByRole("button", { name: /run/i });
    expect(runBtn).toBeDisabled();
  });

  it("renders a Delete button for each case", () => {
    setupDefaultMocks();

    renderWithIntl(<EvalsTab agent={AGENT} />);

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteButtons.length).toBe(2);
  });

  it("calls deleteEvalCase mutation when Delete is clicked", () => {
    setupDefaultMocks();

    renderWithIntl(<EvalsTab agent={AGENT} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete stripe-key-leak" }));

    expect(mockDeleteMutate).toHaveBeenCalledWith({
      agentId: "ag1",
      caseId: "case-1",
    });
  });

  it("renders loading skeleton while cases are loading", () => {
    useEvalCasesMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    useRunAgentEvalsMock.mockReturnValue({ mutate: mockRunMutate, isPending: false });
    useDeleteEvalCaseMock.mockReturnValue({ mutate: mockDeleteMutate, isPending: false });

    const { container } = renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.queryByText("stripe-key-leak")).not.toBeInTheDocument();
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the New case button which opens a modal", () => {
    setupDefaultMocks();

    renderWithIntl(<EvalsTab agent={AGENT} />);

    const newCaseBtn = screen.getByRole("button", { name: /new case/i });
    expect(newCaseBtn).toBeInTheDocument();

    fireEvent.click(newCaseBtn);

    // The modal opens: it renders the "New eval case" title.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows 8+ cases without truncation (AC-5 list capability)", () => {
    // Create 8 cases and verify they all render.
    const manyCases = Array.from({ length: 8 }, (_, i) => ({
      ...CASE_1,
      id: `case-${i + 1}`,
      name: `case-name-${i + 1}`,
    }));
    setupDefaultMocks({ cases: manyCases });

    renderWithIntl(<EvalsTab agent={AGENT} />);

    for (let i = 1; i <= 8; i++) {
      expect(screen.getByText(`case-name-${i}`)).toBeInTheDocument();
    }
  });
});
