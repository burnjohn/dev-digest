import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase } from "@devdigest/shared/contracts/knowledge";
import type { EvalCaseOutcome } from "@devdigest/shared/contracts/knowledge";
import messages from "../../../messages/en/eval.json";
import shellMessages from "../../../messages/en/shell.json";

const updateMutate = vi.fn();
let EVAL_CASE: EvalCase | undefined;

vi.mock("@/lib/hooks/eval", () => ({
  useEvalCase: () => ({ data: EVAL_CASE, isLoading: !EVAL_CASE }),
  useUpdateEvalCase: () => ({ mutate: updateMutate, isPending: false }),
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { CaseEditorPanel } from "./CaseEditorPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  EVAL_CASE = undefined;
});

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "stripe-key-leak",
    input_diff: "diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n",
    input_files: ["src/x.ts"],
    input_meta: { pr_number: 491, title: "Fix auth", body: null },
    expectation: { type: "must_find", file: "src/x.ts", start_line: 1, end_line: 1, severity: "CRITICAL", category: "security", title: null },
    source_finding_id: null,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function outcome(overrides: Partial<EvalCaseOutcome> = {}): EvalCaseOutcome {
  return {
    case_id: "case-1",
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
    ...overrides,
  };
}

function renderPanel(props: { outcome: EvalCaseOutcome | null; withoutOutcome?: EvalCaseOutcome | null }) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages, shell: shellMessages }}>
      <CaseEditorPanel caseId="case-1" onClose={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("CaseEditorPanel — arms rendering", () => {
  it("without the withoutOutcome prop, renders a single outcome summary and no with/without arm labels", () => {
    EVAL_CASE = evalCase();
    renderPanel({ outcome: outcome() });

    // A single pass summary, not doubled.
    expect(screen.getAllByText(new RegExp(messages.evalsTab.passed))).toHaveLength(1);
    expect(screen.queryByText(messages.skill.withArm)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.skill.withoutArm)).not.toBeInTheDocument();
  });

  it("AC-36 — with withoutOutcome present (even null), renders both arms side by side, each with its own outcome", () => {
    EVAL_CASE = evalCase();
    renderPanel({ outcome: outcome({ pass: true }), withoutOutcome: null });

    expect(screen.getByText(messages.skill.withArm)).toBeInTheDocument();
    expect(screen.getByText(messages.skill.withoutArm)).toBeInTheDocument();

    // The with-arm shows a real pass summary; the without-arm (null outcome)
    // shows the "not yet covered" message — these must be two distinct nodes,
    // not the same summary rendered twice.
    expect(screen.getByText(new RegExp(messages.evalsTab.passed))).toBeInTheDocument();
    expect(screen.getByText(messages.caseEditorPanel.outcomeNone)).toBeInTheDocument();
  });

  it("AC-36 — a genuinely errored without-arm outcome (not null) renders its own error reason distinct from a passing with-arm", () => {
    EVAL_CASE = evalCase();
    renderPanel({
      outcome: outcome({ pass: true }),
      withoutOutcome: outcome({ status: "errored", pass: null, error_reason: "provider timeout" }),
    });

    const withoutSection = screen.getByText(messages.skill.withoutArm).closest("div")!;
    expect(within(withoutSection).getByText(/provider timeout/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(messages.evalsTab.passed))).toBeInTheDocument();
  });
});
