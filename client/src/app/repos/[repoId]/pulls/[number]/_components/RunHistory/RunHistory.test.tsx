/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, ReviewRecord } from "@devdigest/shared";
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
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.014,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function renderRuns(runs: RunSummary[], reviews?: ReviewRecord[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} reviews={reviews} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

function review(o: Partial<ReviewRecord>): ReviewRecord {
  return {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "a1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: null,
    score: 40,
    model: "deepseek/deepseek-v4-flash",
    cost_usd: null,
    created_at: "2026-06-11T18:44:34.000Z",
    findings: [],
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

  it("a settled run shows its cost next to the time", () => {
    renderRuns([run({ status: "done", cost_usd: 0.014 })]);
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("a settled run with unknown cost shows the em dash", () => {
    renderRuns([run({ status: "done", cost_usd: null })]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("RunHistory — per-run findings badges", () => {
  it("renders severity badges + a popover for a run matched by run_id, instead of the plain-text count", () => {
    const rev = review({
      run_id: "run-1",
      findings: [
        {
          id: "f-1",
          review_id: "rev-1",
          severity: "CRITICAL",
          category: "security",
          title: "Hardcoded secret",
          file: "src/config.ts",
          start_line: 11,
          end_line: 11,
          rationale: "A live key is committed in source.",
          suggestion: null,
          confidence: 0.9,
          kind: "finding",
          accepted_at: null,
          dismissed_at: null,
        },
      ],
    });
    renderRuns([run({ run_id: "run-1", status: "done", findings_count: 1 })], [rev]);
    expect(screen.queryByText(/1 finding\(s\)/)).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("1"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("falls back to the plain-text findings count for a run with no matching review", () => {
    const rev = review({ run_id: "some-other-run" });
    renderRuns([run({ run_id: "run-1", status: "done", findings_count: 2 })], [rev]);
    expect(screen.getByText(/2 finding\(s\)/)).toBeInTheDocument();
  });
});
