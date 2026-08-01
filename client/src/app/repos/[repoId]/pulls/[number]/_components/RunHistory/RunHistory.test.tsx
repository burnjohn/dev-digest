/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, RunSummary } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
// RunCostBadge on each settled row reads the `runs` namespace.
import runsMessages from "../../../../../../../../messages/en/runs.json";
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

function renderRuns(runs: RunSummary[], findingsByRun?: Map<string, FindingRecord[]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages, runs: runsMessages }}>
      <RunHistory runs={runs} findingsByRun={findingsByRun} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "perf",
    title: `Finding ${o.id}`,
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "because",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
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

describe("RunHistory — severity counters", () => {
  it("breaks a run's findings down by severity instead of a flat count", () => {
    renderRuns(
      [run({ run_id: "r1", status: "done", findings_count: 3, blockers: 2, score: 38 })],
      new Map([
        [
          "r1",
          [
            finding({ id: "c1", severity: "CRITICAL" }),
            finding({ id: "c2", severity: "CRITICAL" }),
            finding({ id: "w1", severity: "WARNING" }),
          ],
        ],
      ]),
    );
    expect(screen.getByRole("button", { name: /2 critical/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 warning/i })).toBeInTheDocument();
    // The flat "3 finding(s)" line it replaces is gone; blockers stay.
    expect(screen.queryByText(/3 finding/)).not.toBeInTheDocument();
    expect(screen.getByText(/2 blockers/)).toBeInTheDocument();
  });

  it("counts only THAT run's findings, not the PR's", () => {
    renderRuns(
      [
        run({ run_id: "r1", agent_name: "Security Reviewer", status: "done", score: 38 }),
        run({ run_id: "r2", agent_name: "Performance Reviewer", status: "done", score: 64 }),
      ],
      new Map([
        ["r1", [finding({ id: "c1", severity: "CRITICAL" })]],
        ["r2", [finding({ id: "s1", severity: "SUGGESTION" })]],
      ]),
    );
    expect(screen.getByRole("button", { name: /1 critical/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 suggestion/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /warning/i })).not.toBeInTheDocument();
  });

  it("opens that run's findings, scoped to the clicked severity", () => {
    renderRuns(
      [run({ run_id: "r1", status: "done", score: 64 })],
      new Map([
        [
          "r1",
          [
            finding({ id: "w1", severity: "WARNING", title: "N+1 query in user list endpoint" }),
            finding({ id: "s1", severity: "SUGGESTION", title: "Extract magic number 3600" }),
          ],
        ],
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: /1 warning/i }));
    const panel = screen.getByRole("dialog");
    expect(within(panel).getByText("N+1 query in user list endpoint")).toBeInTheDocument();
    expect(within(panel).queryByText("Extract magic number 3600")).not.toBeInTheDocument();
    expect(within(panel).getByText(/in this run/i)).toBeInTheDocument();
  });

  it("falls back to the flat count until the reviews behind the timeline load", () => {
    // No findingsByRun map yet — the row must not go blank.
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText(/3 finding/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /critical/i })).not.toBeInTheDocument();
  });

  it("falls back for a failed run, which never produced a review", () => {
    renderRuns(
      [run({ run_id: "r1", status: "failed", error: "429 quota exceeded" })],
      new Map([["other-run", [finding({ id: "w1" })]]]),
    );
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("429 quota exceeded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /warning/i })).not.toBeInTheDocument();
  });

  it("shows the zero state for a clean run rather than an empty gap", () => {
    renderRuns(
      [run({ run_id: "r1", status: "done", findings_count: 0, blockers: 0, score: 95 })],
      new Map([["r1", []]]),
    );
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("No findings")).toBeInTheDocument();
  });
});
