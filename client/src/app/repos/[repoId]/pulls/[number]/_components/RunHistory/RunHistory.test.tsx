/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    critical_count: null,
    warning_count: null,
    suggestion_count: null,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(
  runs: RunSummary[],
  opts: { findingsByRun?: Map<string, FindingRecord[]>; onOpenTrace?: (id: string) => void } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory
        runs={runs}
        findingsByRun={opts.findingsByRun}
        onOpenTrace={opts.onOpenTrace ?? (() => {})}
      />
    </NextIntlClientProvider>,
  );
}

let seq = 0;
function finding(o: Partial<FindingRecord>): FindingRecord {
  seq += 1;
  return {
    id: `f-${seq}`,
    review_id: "rev-1",
    severity: "WARNING",
    category: "bug",
    title: `Finding ${seq}`,
    file: "src/a.ts",
    start_line: 1,
    end_line: 2,
    rationale: "why",
    suggestion: null,
    confidence: 0.8,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — run cost", () => {
  it("shows tokens and cost on a settled run", () => {
    renderRuns([run({ status: "done", tokens_in: 8000, tokens_out: 1119, cost_usd: 0.0013 })]);
    expect(screen.getByText("9,119 tok · $0.0013")).toBeInTheDocument();
  });

  it('shows "—" when the cost is unknown, never $0.00', () => {
    renderRuns([run({ status: "done", tokens_in: 0, tokens_out: 0, cost_usd: null })]);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("keeps a genuinely free run distinct from an unknown one", () => {
    renderRuns([run({ status: "done", tokens_in: 100, tokens_out: 50, cost_usd: 0 })]);
    expect(screen.getByText("150 tok · $0.00")).toBeInTheDocument();
  });

  it("shows no cost line for a run that has not settled", () => {
    renderRuns([run({ status: "running", score: null, blockers: null, cost_usd: null })]);
    expect(screen.queryByText(/tok ·/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — severity badges", () => {
  const mapFor = (runId: string, findings: FindingRecord[]) =>
    new Map([[runId, findings]]);

  it("replaces the plain findings text with badges, keeping the blockers suffix", () => {
    renderRuns(
      [run({ status: "done", findings_count: 3, blockers: 2, score: 38 })],
      {
        findingsByRun: mapFor("run-1", [
          finding({ severity: "CRITICAL" }),
          finding({ severity: "CRITICAL" }),
          finding({ severity: "WARNING" }),
        ]),
      },
    );
    expect(screen.queryByText("3 finding(s)")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Findings by severity/)).toBeInTheDocument();
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });

  it("falls back to the plain text when the run has no joined findings", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0 })], {
      findingsByRun: new Map(),
    });
    expect(screen.getByText("3 finding(s)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Findings by severity/)).not.toBeInTheDocument();
  });

  it("clicking the badge group opens the trace for that run", () => {
    const onOpenTrace = vi.fn();
    renderRuns(
      [run({ status: "done", findings_count: 1, blockers: 0 })],
      { findingsByRun: mapFor("run-1", [finding({ severity: "WARNING" })]), onOpenTrace },
    );
    fireEvent.click(screen.getByLabelText(/Findings by severity/));
    expect(onOpenTrace).toHaveBeenCalledWith("run-1");
  });
});
