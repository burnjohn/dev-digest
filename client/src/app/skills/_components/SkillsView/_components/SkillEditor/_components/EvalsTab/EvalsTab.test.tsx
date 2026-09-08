import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import type { EvalSkillCarrier, EvalSkillRunRecord } from "@devdigest/shared/contracts/eval-ci";
import type { EvalCase } from "@devdigest/shared/contracts/knowledge";
import messages from "../../../../../../../../../messages/en/eval.json";

const startSkillRunMutate = vi.fn();
const deleteCaseMutate = vi.fn();

let CASES: EvalCase[] = [];
let RUNS: EvalSkillRunRecord[] = [];
let CARRIERS: EvalSkillCarrier[] = [];

vi.mock("@/lib/hooks/eval", () => ({
  useSkillEvalCases: () => ({ data: CASES, isLoading: false }),
  useSkillEvalRuns: () => ({ data: RUNS }),
  useSkillEvalCarriers: () => ({ data: CARRIERS }),
  useSkillEvalRun: () => ({ data: undefined }),
  useSkillEvalEstimate: (skillId: string | null, carrierId: string | null) =>
    carrierId
      ? {
          data: {
            cases_total: CASES.length,
            executions_total: CASES.length * 2,
            carrier_agent_id: carrierId,
            carrier_agent_name: CARRIERS.find((c) => c.agent_id === carrierId)?.agent_name ?? "",
            gates_bypassed: !CARRIERS.find((c) => c.agent_id === carrierId)?.skill_enabled,
          },
        }
      : { data: undefined },
  useStartSkillEvalRun: () => ({ mutate: startSkillRunMutate, isPending: false }),
  useCreateSkillEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
  useSkillEvalCompare: () => ({ data: undefined, isLoading: false, isError: false }),
  useDeleteEvalCase: () => ({ mutate: deleteCaseMutate }),
  useEvalCase: () => ({ data: undefined, isLoading: true }),
  useUpdateEvalCase: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/skills", () => ({
  useSkillPreview: () => ({ data: { block: "", tokens: 128, project_context_block: null, project_context_tokens: 0 } }),
}));

vi.mock("@/lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const SKILL: Skill = {
  id: "skill-1",
  name: "secret-leakage-gate",
  description: "Flags hardcoded secrets.",
  type: "security",
  source: "manual",
  body: "# Secret leakage gate\nFlag any `sk_live_` prefixed literal.",
  enabled: true,
  version: 1,
};

function evalCase(id: string, name: string, sourceFindingId: string | null = null): EvalCase {
  return {
    id,
    owner_kind: "skill",
    owner_id: "skill-1",
    name,
    input_diff: "diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,2 @@\n-a\n+b\n",
    input_files: ["src/x.ts"],
    input_meta: { pr_number: 491, title: "Fix auth", body: null },
    expectation: { type: "must_find", file: "src/x.ts", start_line: 1, end_line: 1, severity: "CRITICAL", category: "security", title: "x" },
    source_finding_id: sourceFindingId,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function skillRun(overrides: Partial<EvalSkillRunRecord> = {}): EvalSkillRunRecord {
  return {
    id: "run-1",
    owner_kind: "skill",
    owner_id: "skill-1",
    agent_name: null,
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
    duration_ms: 2000,
    cost_usd: 0.02,
    error_reason: null,
    skill_version: 1,
    carrier_agent_id: "agent-1",
    carrier_agent_name: "Security Reviewer",
    gates_bypassed: false,
    arm_without: null,
    lift: { recall: 0.25, precision: 0, citation_accuracy: 0 },
    effects: [{ case_id: "c1", name: "stripe-key-leak", effect: "helped" }],
    effect_counts: { helped: 1, hurt: 0, no_effect_pass: 0, no_effect_fail: 0 },
    ...overrides,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("EvalsTab (skill) — specs/15-skill-eval-cases.md", () => {
  it("AC-37: states no cases exist and shows no metric or lift values", () => {
    CASES = [];
    RUNS = [];
    CARRIERS = [];
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.getByText(messages.skill.empty.noCases)).toBeInTheDocument();
    expect(screen.getAllByText("n/a").length).toBeGreaterThan(0);
  });

  it("AC-38: states the skill has never been run when cases exist but no run has completed", () => {
    CASES = [evalCase("c1", "stripe-key-leak")];
    RUNS = [];
    CARRIERS = [{ agent_id: "agent-1", agent_name: "Security Reviewer", skill_enabled: true, link_enabled: true }];
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.getByText("stripe-key-leak")).toBeInTheDocument();
    expect(screen.getByText(messages.skill.empty.neverRun)).toBeInTheDocument();
  });

  it("AC-35: shows a case's origin and its latest run's effect classification", () => {
    CASES = [evalCase("c1", "stripe-key-leak", "finding-1")];
    RUNS = [skillRun()];
    CARRIERS = [{ agent_id: "agent-1", agent_name: "Security Reviewer", skill_enabled: true, link_enabled: true }];
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.getByText(messages.skill.origin.finding)).toBeInTheDocument();
    expect(screen.getByText(messages.skill.effect.helped)).toBeInTheDocument();
  });

  it("AC-41: an all-zero lift renders as a stated sentence, never a bare 0", () => {
    CASES = [evalCase("c1", "stripe-key-leak")];
    RUNS = [skillRun({ lift: { recall: 0, precision: 0, citation_accuracy: 0 } })];
    CARRIERS = [{ agent_id: "agent-1", agent_name: "Security Reviewer", skill_enabled: true, link_enabled: true }];
    renderWithIntl(<EvalsTab skill={SKILL} />);
    expect(screen.getByText(messages.skill.lift.allZero)).toBeInTheDocument();
    expect(screen.queryByText("+0.0pp")).not.toBeInTheDocument();
    expect(screen.queryByText("0.0pp")).not.toBeInTheDocument();
  });

  it("AC-11/AC-25/AC-49: the run modal states the carrier picker, the 2N-execution estimate and a gate-bypass warning, before any POST", () => {
    CASES = [evalCase("c1", "stripe-key-leak"), evalCase("c2", "second-case")];
    RUNS = [];
    CARRIERS = [{ agent_id: "agent-1", agent_name: "Security Reviewer", skill_enabled: false, link_enabled: true }];
    renderWithIntl(<EvalsTab skill={SKILL} />);

    fireEvent.click(screen.getByRole("button", { name: /run eval/i }));

    const dialog = screen.getByRole("dialog");

    // AC-11 — carrier picker present.
    expect(within(dialog).getByText(messages.skill.run.carrierLabel)).toBeInTheDocument();
    // AC-25 — 2 cases -> 4 executions, stated before any execution starts.
    expect(within(dialog).getByText(/4 case executions/)).toBeInTheDocument();
    // AC-11/AC-52 — the disabled gate is stated as a warning before the POST.
    expect(within(dialog).getByText(messages.skill.run.gatesBypassedWarning)).toBeInTheDocument();
    expect(startSkillRunMutate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: messages.skill.run.confirm }));
    expect(startSkillRunMutate).toHaveBeenCalledWith(
      { skillId: "skill-1", carrierAgentId: "agent-1" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it("AC-49: states that no agent is linked when there are no carriers, and disables the run", () => {
    CASES = [evalCase("c1", "stripe-key-leak")];
    RUNS = [];
    CARRIERS = [];
    renderWithIntl(<EvalsTab skill={SKILL} />);
    fireEvent.click(screen.getByRole("button", { name: /run eval/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(messages.skill.run.noCarriers)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: messages.skill.run.confirm })).toBeDisabled();
  });
});
