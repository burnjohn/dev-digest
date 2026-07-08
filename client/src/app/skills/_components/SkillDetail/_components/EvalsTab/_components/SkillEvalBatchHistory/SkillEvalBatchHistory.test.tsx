import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SkillEvalBatch, SkillEvalBatchDetail, SkillEvalBatchCompareResult, Agent } from "@devdigest/shared";
import skillsMessages from "../../../../../../../../../messages/en/skills.json";

// ---- Mocks -----------------------------------------------------------------

let batchDetailData: SkillEvalBatchDetail | undefined = undefined;
let compareData: SkillEvalBatchCompareResult | undefined = undefined;

vi.mock("@/lib/hooks/skills", () => ({
  useSkillEvalBatchDetail: () => ({ data: batchDetailData, isLoading: false }),
  useSkillEvalCompare: () => ({ data: compareData }),
}));

import { SkillEvalBatchHistory } from "./SkillEvalBatchHistory";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const AGENTS: Agent[] = [
  { id: "a1", name: "General Reviewer" } as unknown as Agent,
  { id: "a2", name: "Test Quality Reviewer" } as unknown as Agent,
];

function makeBatch(overrides: Partial<SkillEvalBatch> = {}): SkillEvalBatch {
  return {
    id: "batch-1",
    skill_id: "sk1",
    host_agent_id: "a1",
    kind: "full",
    status: "clean",
    snapshot_identity: {},
    model: "gpt-4.1",
    judge_score: 0.8,
    grounding_pass_rate: 1,
    cases_passing: 4,
    cases_total: 5,
    cost_usd: 0.05,
    ran_at: "2026-07-06T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  batchDetailData = undefined;
  compareData = undefined;
});

describe("SkillEvalBatchHistory — checkbox selection (full-kind only)", () => {
  it("shows a disabled placeholder (not a checkbox) for calibration-kind batches", () => {
    const batches = [
      makeBatch({ id: "full-1", kind: "full" }),
      makeBatch({ id: "calib-1", kind: "calibration", ran_at: "2026-07-05T00:00:00Z" }),
    ];
    renderWithIntl(<SkillEvalBatchHistory skillId="sk1" batches={batches} agents={AGENTS} />);

    // Only ONE real checkbox exists — for the full-kind batch.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    // The calibration row's placeholder carries the "compare full only" tooltip.
    expect(screen.getByTitle("Only full-batch runs can be compared.")).toBeInTheDocument();
  });

  it("selecting two full-kind batches renders the compare panel; a third replaces the oldest selection", async () => {
    const batches = [
      makeBatch({ id: "b1", ran_at: "2026-07-06T00:00:00Z" }),
      makeBatch({ id: "b2", ran_at: "2026-07-05T00:00:00Z" }),
      makeBatch({ id: "b3", ran_at: "2026-07-04T00:00:00Z" }),
    ];
    compareData = {
      a: { ...makeBatch({ id: "b1" }), cases: [] } as SkillEvalBatchDetail,
      b: { ...makeBatch({ id: "b2" }), cases: [] } as SkillEvalBatchDetail,
      deltas: { judge_score: 0.1, grounding_pass_rate: 0, cases_passing_rate: 0.05 },
    };
    const user = userEvent.setup();
    renderWithIntl(<SkillEvalBatchHistory skillId="sk1" batches={batches} agents={AGENTS} />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);

    // One selected → "select two" hint, no compare panel yet.
    await user.click(checkboxes[0]!);
    expect(screen.getByText("Select exactly two batches to compare.")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-batch-compare-panel")).not.toBeInTheDocument();

    // Two selected → compare panel renders.
    await user.click(checkboxes[1]!);
    expect(screen.getByTestId("skill-batch-compare-panel")).toBeInTheDocument();
    expect(screen.queryByText("Select exactly two batches to compare.")).not.toBeInTheDocument();

    // A third selection replaces the OLDEST (first-selected) id, keeping
    // exactly 2 selected — mirrors the agent-eval toggleSelected's
    // `[prev[1], id]` logic.
    await user.click(checkboxes[2]!);
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).toBeChecked();
  });
});

describe("SkillEvalBatchHistory — row click expands drill-down", () => {
  it("expands a per-case drill-down table when a row is clicked", async () => {
    const batches = [makeBatch({ id: "b1" })];
    batchDetailData = {
      ...makeBatch({ id: "b1" }),
      cases: [
        {
          case_id: "c1",
          case_name: "No mock overuse — happy path",
          status: "passed",
          grounding_missing: [],
          judge_score: 0.9,
          judge_evidence: null,
          cost_usd: 0.002,
          error_message: null,
        },
        {
          case_id: "c2",
          case_name: "Grounding gate failed",
          status: "failed_grounding",
          grounding_missing: ["Math.random()"],
          judge_score: null,
          judge_evidence: null,
          cost_usd: 0.001,
          error_message: null,
        },
      ],
    } as SkillEvalBatchDetail;
    const user = userEvent.setup();
    renderWithIntl(<SkillEvalBatchHistory skillId="sk1" batches={batches} agents={AGENTS} />);

    expect(screen.queryByText("No mock overuse — happy path")).not.toBeInTheDocument();

    // Click the row (not the checkbox cell) to expand.
    await user.click(screen.getByText("gpt-4.1"));

    expect(screen.getByText("No mock overuse — happy path")).toBeInTheDocument();
    expect(screen.getByText("Grounding gate failed")).toBeInTheDocument();
    expect(screen.getByText("Math.random()")).toBeInTheDocument();
  });
});

describe("SkillEvalBatchHistory — highlightBatchId visually distinguishes the matching row", () => {
  it("applies a highlighted background to the row matching highlightBatchId", () => {
    const batches = [makeBatch({ id: "b1" }), makeBatch({ id: "b2" })];
    renderWithIntl(
      <SkillEvalBatchHistory skillId="sk1" batches={batches} agents={AGENTS} highlightBatchId="b2" />,
    );

    const rows = screen.getAllByRole("row").filter((r) => within(r).queryByText("gpt-4.1"));
    expect(rows).toHaveLength(2);
    // The row NOT matching highlightBatchId has no background override.
    expect(rows[0]).toHaveStyle({ background: undefined });
    // The row matching highlightBatchId is highlighted.
    expect(rows[1]).toHaveStyle({ background: "var(--bg-hover)" });
  });
});
