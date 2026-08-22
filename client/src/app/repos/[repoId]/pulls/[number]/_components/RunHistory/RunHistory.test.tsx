/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary } from "@devdigest/shared";
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
    cost_usd: null,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    findings_critical: null,
    findings_warning: null,
    findings_suggestion: null,
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

  it("a settled run shows total tokens · cost; a missing cost shows '—' not '$0.00'", () => {
    renderRuns([
      run({ status: "done", tokens_in: 9000, tokens_out: 119, cost_usd: 0.0013, score: 80 }),
    ]);
    expect(screen.getByText(/9,119 tok · \$0\.0013/)).toBeInTheDocument();

    cleanup();
    renderRuns([run({ status: "done", tokens_in: 0, tokens_out: 0, cost_usd: null, score: 80 })]);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });
});

describe("RunHistory — per-severity chips", () => {
  it("shows SeverityChip counts when findings_critical/warning/suggestion are set", () => {
    renderRuns([
      run({
        status: "done",
        findings_count: 6,
        blockers: 2,
        score: 45,
        findings_critical: 2,
        findings_warning: 3,
        findings_suggestion: 1,
      }),
    ]);
    expect(screen.getByText("2")).toBeInTheDocument(); // critical count
    expect(screen.getByText("3")).toBeInTheDocument(); // warning count
    expect(screen.getByText("1")).toBeInTheDocument(); // suggestion count
  });

  it("shows no chips when all per-severity counts are null", () => {
    const { container } = renderRuns([
      run({
        status: "done",
        findings_count: 0,
        blockers: 0,
        score: 90,
        findings_critical: null,
        findings_warning: null,
        findings_suggestion: null,
      }),
    ]);
    // SeverityChip renders faded dots with opacity:0.2 — none should appear
    const fadedDots = container.querySelectorAll('[style*="opacity: 0.2"]');
    expect(fadedDots).toHaveLength(0);
  });

  it("shows only non-zero chips", () => {
    renderRuns([
      run({
        status: "done",
        findings_count: 4,
        blockers: 4,
        score: 20,
        findings_critical: 4,
        findings_warning: 0,
        findings_suggestion: 0,
      }),
    ]);
    expect(screen.getByText("4")).toBeInTheDocument();
    // warning=0, suggestion=0 → no chips for those counts
    expect(screen.queryAllByText("0")).toHaveLength(0);
  });
});
