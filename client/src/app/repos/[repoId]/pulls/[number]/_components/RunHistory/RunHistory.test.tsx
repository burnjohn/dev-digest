/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

let fid = 0;
function finding(o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: `f${fid++}`,
    severity: "CRITICAL",
    category: "bug",
    title: "Null deref",
    file: "src/a.ts",
    start_line: 10,
    end_line: 10,
    rationale: "boom",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

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
    tokens_in: 100,
    tokens_out: 50,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    cost_usd: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
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

  it("a settled run shows the 'N tok · $X' line", () => {
    renderRuns([run({ status: "done", tokens_in: 9000, tokens_out: 119, cost_usd: 0.0013 })]);
    expect(screen.getByText("9,119t · $0.0013")).toBeInTheDocument();
  });

  it("a settled run with no token/cost data omits the tok·$ line", () => {
    renderRuns([run({ status: "done", tokens_in: null, tokens_out: null, cost_usd: null })]);
    expect(screen.queryByText(/\dt ·/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — per-run severity indicator", () => {
  it("renders a severity strip for a settled run's findings", () => {
    const findingsByRun = new Map<string, FindingRecord[]>([
      [
        "run-1",
        [
          finding({ severity: "CRITICAL" }),
          finding({ severity: "CRITICAL" }),
          finding({ severity: "WARNING", title: "Unused var" }),
        ],
      ],
    ]);
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunHistory
          runs={[run({ run_id: "run-1", status: "done", findings_count: 3 })]}
          findingsByRun={findingsByRun}
          onOpenTrace={() => {}}
        />
      </NextIntlClientProvider>,
    );
    // aria-labels carry the per-severity counts ("2 critical findings", "1 warning finding").
    expect(screen.getByRole("button", { name: /2 critical findings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 warning finding/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /suggestion/i })).not.toBeInTheDocument();
  });

  it("renders no indicator for a run with no matching findings", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <RunHistory
          runs={[run({ run_id: "run-2", status: "done", findings_count: 0 })]}
          onOpenTrace={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("button", { name: /critical|warning|suggestion/i })).not.toBeInTheDocument();
  });
});
