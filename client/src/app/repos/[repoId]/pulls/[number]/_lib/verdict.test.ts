/**
 * _lib/verdict — the per-run judgements (`deriveVerdict` / `blockerCount` /
 * `liveFindings` / `runForReview`) and the PR-wide layer built on top of them
 * (`latestReviewPerAgent` / `aggregatePr`). All pure, so they are tested
 * without mounting anything.
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord, ReviewRecord, RunSummary } from "@devdigest/shared";
import {
  aggregatePr,
  blockerCount,
  deriveVerdict,
  latestReviewPerAgent,
  liveFindings,
  runForReview,
} from "./verdict";

function finding(o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    review_id: "r1",
    severity: "WARNING",
    category: "bug",
    title: "t",
    body: "b",
    file: "a.ts",
    start_line: null,
    end_line: null,
    suggestion: null,
    confidence: null,
    kind: null,
    accepted_at: null,
    dismissed_at: null,
    ...o,
  } as FindingRecord;
}

function run(o: Partial<RunSummary> = {}): RunSummary {
  return {
    run_id: "run-1",
    agent_id: null,
    agent_name: null,
    provider: null,
    model: null,
    status: "done",
    error: null,
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    findings_count: null,
    grounding: null,
    ran_at: null,
    score: null,
    blockers: null,
    cost_usd: null,
    ...o,
  };
}

function review(o: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "rev-1",
    pr_id: "pr-1",
    agent_id: "agent-1",
    run_id: "run-1",
    agent_name: "General Reviewer",
    kind: "review",
    verdict: null,
    summary: null,
    score: null,
    model: null,
    grounding: null,
    created_at: "2026-08-26T10:00:00.000Z",
    findings: [],
    ...o,
  } as ReviewRecord;
}

describe("deriveVerdict", () => {
  it("is request_changes as soon as one finding trips the gate", () => {
    expect(deriveVerdict(1, 1)).toBe("request_changes");
    expect(deriveVerdict(2, 6)).toBe("request_changes");
  });

  it("is comment when there are findings but none block", () => {
    expect(deriveVerdict(0, 6)).toBe("comment");
  });

  it("is approve only with no findings at all", () => {
    expect(deriveVerdict(0, 0)).toBe("approve");
  });

  it("never reads a model-supplied verdict — blockers alone decide", () => {
    // The mutation this catches: swapping the derivation for
    // `review.verdict`. A run whose model said "approve" over two blockers
    // must still headline Request changes (reviewer-core to-review.ts).
    expect(deriveVerdict(2, 2)).toBe("request_changes");
  });
});

describe("liveFindings", () => {
  it("drops dismissed findings", () => {
    const kept = finding({ id: "keep" });
    const gone = finding({ id: "gone", dismissed_at: "2026-08-26T00:00:00.000Z" });
    expect(liveFindings([kept, gone])).toEqual([kept]);
  });
});

describe("blockerCount", () => {
  it("prefers the run row's persisted, gate-aware count", () => {
    // `blockers: 3` with only one CRITICAL is exactly the case that proves the
    // preference: an agent with `ci_fail_on: warning` blocks on warnings too,
    // and only the persisted number knows that.
    const findings = [finding({ severity: "CRITICAL" }), finding(), finding()];
    expect(blockerCount(run({ blockers: 3 }), findings)).toBe(3);
  });

  it("keeps a persisted zero rather than falling through to CRITICAL counting", () => {
    // `?? ` not `||` — a run that legitimately blocked on nothing must not be
    // recomputed from severities.
    expect(blockerCount(run({ blockers: 0 }), [finding({ severity: "CRITICAL" })])).toBe(0);
  });

  it("falls back to non-dismissed CRITICALs when the run row has no count", () => {
    const findings = [
      finding({ id: "a", severity: "CRITICAL" }),
      finding({ id: "b", severity: "CRITICAL", dismissed_at: "2026-08-26T00:00:00.000Z" }),
      finding({ id: "c", severity: "WARNING" }),
    ];
    expect(blockerCount(run({ blockers: null }), findings)).toBe(1);
    expect(blockerCount(null, findings)).toBe(1);
  });
});

describe("runForReview", () => {
  const review = { run_id: "run-2" } as ReviewRecord;

  it("joins on run_id", () => {
    const target = run({ run_id: "run-2" });
    expect(runForReview(review, [run({ run_id: "run-1" }), target])).toBe(target);
  });

  it("returns null rather than guessing when there is no match or no run_id", () => {
    expect(runForReview(review, [run({ run_id: "run-9" })])).toBeNull();
    expect(runForReview({ run_id: null } as ReviewRecord, [run()])).toBeNull();
    expect(runForReview(null, [run()])).toBeNull();
    expect(runForReview(review, undefined)).toBeNull();
  });
});

describe("latestReviewPerAgent", () => {
  it("keeps only the newest review for a re-run agent", () => {
    // The mutation this catches: dropping the grouping and aggregating every
    // row, which double-counts an agent that was run twice.
    const older = review({ id: "a", created_at: "2026-08-26T10:00:00.000Z" });
    const newer = review({ id: "b", created_at: "2026-08-26T11:00:00.000Z" });
    expect(latestReviewPerAgent([newer, older])).toEqual([newer]);
    expect(latestReviewPerAgent([older, newer])).toEqual([newer]);
  });

  it("keeps one review per agent when several agents reviewed", () => {
    const sec = review({ id: "a", agent_id: "sec" });
    const gen = review({ id: "b", agent_id: "gen" });
    expect(latestReviewPerAgent([sec, gen])).toHaveLength(2);
  });

  it("breaks a created_at tie on id, whatever order the rows arrive in", () => {
    // Agents fan out concurrently and `created_at` is `defaultNow()`, so a tie
    // is a real case — and without the id tie-break the winner would depend on
    // however Postgres happened to order the rows.
    const a = review({ id: "a" });
    const b = review({ id: "b" });
    expect(latestReviewPerAgent([a, b])).toEqual([b]);
    expect(latestReviewPerAgent([b, a])).toEqual([b]);
  });

  it("does not collapse two agent-less rows into one group", () => {
    const one = review({ id: "a", agent_id: null, agent_name: null });
    const two = review({ id: "b", agent_id: null, agent_name: null });
    expect(latestReviewPerAgent([one, two])).toHaveLength(2);
  });

  it("groups on agent_name when agent_id is missing", () => {
    const older = review({ id: "a", agent_id: null, agent_name: "Security" });
    const newer = review({
      id: "b",
      agent_id: null,
      agent_name: "Security",
      created_at: "2026-08-26T12:00:00.000Z",
    });
    expect(latestReviewPerAgent([older, newer])).toEqual([newer]);
  });

  it("skips summary rows and rows whose findings drifted from an array", () => {
    // `api.get` is a cast with no runtime parse (client/INSIGHTS.md
    // 2026-08-25) — a drifted row must be skipped, not thrown on.
    const summary = review({ id: "a", agent_id: "x", kind: "summary" });
    const drifted = review({ id: "b", agent_id: "y", findings: null as never });
    expect(latestReviewPerAgent([summary, drifted])).toEqual([]);
  });
});

describe("aggregatePr", () => {
  /* The reported bug, as a test: three agents on one PR, the approving one
     completing LAST. The band used to render `reviews[0]` and so headlined
     Approve / 0 findings / 100 over a run that had rejected the PR. */
  const security = review({
    id: "rev-sec",
    agent_id: "sec",
    agent_name: "Security Reviewer",
    run_id: "run-sec",
    created_at: "2026-08-26T17:01:43.000Z",
    findings: [],
  });
  const general = review({
    id: "rev-gen",
    agent_id: "gen",
    agent_name: "General Reviewer",
    run_id: "run-gen",
    created_at: "2026-08-26T16:46:52.000Z",
    findings: [finding({ id: "g1" }), finding({ id: "g2" })],
  });
  const contract = review({
    id: "rev-api",
    agent_id: "api",
    agent_name: "API Contract Reviewer",
    run_id: "run-api",
    created_at: "2026-08-26T16:40:10.000Z",
    findings: Array.from({ length: 6 }, (_, i) =>
      finding({ id: `c${i}`, severity: i < 4 ? "CRITICAL" : "WARNING" }),
    ),
  });
  const threeRuns = [security, general, contract];
  const threeRunRows = [
    run({ run_id: "run-sec", score: 100, blockers: 0, cost_usd: 0.0004, tokens_in: 5825, tokens_out: 287 }),
    run({ run_id: "run-gen", score: 85, blockers: 0, cost_usd: 0.0015, tokens_in: 12000, tokens_out: 492 }),
    run({ run_id: "run-api", score: 0, blockers: 4, cost_usd: 0.0247, tokens_in: 121000, tokens_out: 1053 }),
  ];

  it("sums every agent's findings and blockers instead of reading the newest run", () => {
    const agg = aggregatePr(threeRuns, threeRunRows);
    expect(agg).toMatchObject({
      findingsCount: 8,
      blockers: 4,
      verdict: "request_changes",
      runCount: 3,
    });
  });

  it("is stable however the reviews are ordered", () => {
    const forward = aggregatePr(threeRuns, threeRunRows);
    const reversed = aggregatePr([...threeRuns].reverse(), threeRunRows);
    expect(reversed).toEqual(forward);
  });

  it("averages the scores across the counted runs", () => {
    // 100 + 85 + 0 over three runs — rounded, not truncated.
    expect(aggregatePr(threeRuns, threeRunRows)?.score).toBe(62);
  });

  it("sums cost and tokens across the counted runs", () => {
    const agg = aggregatePr(threeRuns, threeRunRows);
    expect(agg?.costUsd).toBeCloseTo(0.0266, 6);
    expect(agg?.tokensIn).toBe(138825);
    expect(agg?.tokensOut).toBe(1832);
  });

  it("does not count a re-run agent twice", () => {
    const rerun = review({
      id: "rev-api-2",
      agent_id: "api",
      run_id: "run-api-2",
      created_at: "2026-08-26T18:00:00.000Z",
      findings: [finding({ id: "fixed" })],
    });
    const agg = aggregatePr([...threeRuns, rerun], [
      ...threeRunRows,
      run({ run_id: "run-api-2", score: 90, blockers: 0 }),
    ]);
    // The API agent's 6 findings / 4 blockers are REPLACED by its re-run's 1/0.
    expect(agg).toMatchObject({ findingsCount: 3, blockers: 0, verdict: "comment", runCount: 3 });
  });

  it("excludes dismissed findings from the total", () => {
    const agg = aggregatePr(
      [review({ findings: [finding({ id: "a" }), finding({ id: "b", dismissed_at: "2026-08-26T00:00:00.000Z" })] })],
      [],
    );
    expect(agg?.findingsCount).toBe(1);
  });

  it("derives approve only when no agent found anything", () => {
    expect(aggregatePr([security], threeRunRows)).toMatchObject({
      findingsCount: 0,
      blockers: 0,
      verdict: "approve",
    });
  });

  it("reports null — not zero — when nothing carries a score, cost or tokens", () => {
    // "$0.00" and "not known" are different claims; `cost_usd` is null for
    // unknown-price models.
    const agg = aggregatePr([review({ run_id: null, score: null })], []);
    expect(agg).toMatchObject({ score: null, costUsd: null, tokensIn: null, tokensOut: null });
  });

  it("falls back to the review's own score when the run row is missing", () => {
    expect(aggregatePr([review({ run_id: null, score: 70 })], [])?.score).toBe(70);
  });

  it("is null when the PR has never been reviewed", () => {
    // This null is what keeps the band rendering the brief alone — no verdict
    // row, no ring, no cost strip.
    expect(aggregatePr([], [])).toBeNull();
    expect(aggregatePr(undefined, undefined)).toBeNull();
    expect(aggregatePr({ not: "an array" } as never, [])).toBeNull();
  });
});
