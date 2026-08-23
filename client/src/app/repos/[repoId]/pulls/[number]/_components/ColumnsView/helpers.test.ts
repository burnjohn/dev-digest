/**
 * `deriveLiveColumns` — the running/done/failed-per-agent live-status
 * overlay `ColumnsView` renders as columns, extracted out of the component's
 * JSX (mentor feedback on the L07 homework: no independently testable
 * function existed for this). Pure data-in/data-out: no render needed.
 */
import { describe, it, expect } from "vitest";
import type { RunSummary, ReviewRecord, FindingRecord } from "@devdigest/shared";
import { deriveLiveColumns } from "./helpers";

function run(overrides: Partial<RunSummary>): RunSummary {
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
    multi_agent_run_id: null,
    ...overrides,
  };
}

function finding(overrides: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "finding",
    file: "src/x.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewRecord>): ReviewRecord {
  return {
    id: "r1",
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "request_changes",
    summary: null,
    score: 38,
    model: "deepseek/deepseek-v4-flash",
    grounding: null,
    created_at: "2026-06-11T18:44:34.000Z",
    findings: [],
    ...overrides,
  };
}

describe("deriveLiveColumns", () => {
  it("maps running/done/failed statuses to distinct outcomes and settled flags, joining reviews by run_id regardless of array order", () => {
    const runs: RunSummary[] = [
      run({ run_id: "run-running", status: "running" }),
      run({ run_id: "run-clean", status: "done", findings_count: 0, blockers: 0, score: 95 }),
      run({ run_id: "run-rejected", status: "done", findings_count: 1, blockers: 1, score: 20 }),
      run({ run_id: "run-failed", status: "failed", error: "timeout after 60s" }),
    ];
    // Reviews given in an order that doesn't match `runs` — the join must be
    // by run_id, never by array position.
    const reviews: ReviewRecord[] = [
      review({ run_id: "run-rejected", findings: [finding({ id: "f-rejected" })] }),
      review({ run_id: "run-clean", findings: [] }),
    ];

    const columns = deriveLiveColumns(runs, reviews);

    expect(columns).toHaveLength(4);
    expect(columns.map((c) => c.run.run_id)).toEqual(["run-running", "run-clean", "run-rejected", "run-failed"]);

    const running = columns[0]!;
    expect(running.outcome.key).toBe("running");
    expect(running.settled).toBe(false);
    expect(running.findings).toEqual([]);

    const clean = columns[1]!;
    expect(clean.outcome.key).toBe("approved");
    expect(clean.settled).toBe(true);
    expect(clean.findings).toEqual([]);

    const rejected = columns[2]!;
    expect(rejected.outcome.key).toBe("rejected");
    expect(rejected.settled).toBe(true);
    expect(rejected.findings.map((f) => f.id)).toEqual(["f-rejected"]);

    const failed = columns[3]!;
    expect(failed.outcome.key).toBe("error");
    expect(failed.settled).toBe(false);
    expect(failed.findings).toEqual([]);
  });

  it("a run with no matching review yet safely defaults to an empty findings array", () => {
    const [column] = deriveLiveColumns([run({ run_id: "run-1", status: "done" })], []);
    expect(column!.review).toBeUndefined();
    expect(column!.findings).toEqual([]);
  });

  it("empty runs produces no columns", () => {
    expect(deriveLiveColumns([], [])).toEqual([]);
  });
});
