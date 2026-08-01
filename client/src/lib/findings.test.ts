/**
 * findings.ts — the client half of the severity rollup. These rules MUST match
 * `server/src/modules/pulls/status.ts`, because the PR list gets its counts from
 * the API while the popovers derive theirs here: any divergence shows up as a
 * chip saying "2" over a list of 3.
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import {
  countBySeverity,
  countedFindings,
  findingsByRun,
  findingsOfSeverity,
  lineLabel,
  totalCount,
} from "./findings";

function finding(o: Partial<FindingRecord> & { id: string }): FindingRecord {
  return {
    severity: "WARNING",
    category: "bug",
    title: "Something",
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

function review(o: Partial<ReviewRecord> & { id: string }): ReviewRecord {
  return {
    pr_id: "pr1",
    agent_id: "agent-a",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "comment",
    summary: null,
    score: 70,
    model: "gpt-4.1",
    created_at: "2026-06-11T10:00:00.000Z",
    findings: [],
    ...o,
  };
}

describe("countBySeverity", () => {
  it("tallies each severity", () => {
    expect(
      countBySeverity([
        finding({ id: "1", severity: "CRITICAL" }),
        finding({ id: "2", severity: "CRITICAL" }),
        finding({ id: "3", severity: "WARNING" }),
        finding({ id: "4", severity: "SUGGESTION" }),
      ]),
    ).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it("skips dismissed findings", () => {
    expect(
      countBySeverity([
        finding({ id: "1", severity: "CRITICAL" }),
        finding({ id: "2", severity: "CRITICAL", dismissed_at: "2026-06-11T12:00:00.000Z" }),
      ]),
    ).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });
  });

  it("counts accepted findings — accepting confirms a finding, it does not clear it", () => {
    expect(
      countBySeverity([
        finding({ id: "1", severity: "WARNING", accepted_at: "2026-06-11T12:00:00.000Z" }),
      ]),
    ).toEqual({ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 });
  });

  it("counts low-confidence findings — that filter is a view toggle, not a tally rule", () => {
    expect(countBySeverity([finding({ id: "1", severity: "WARNING", confidence: 0.1 })])).toEqual({
      CRITICAL: 0,
      WARNING: 1,
      SUGGESTION: 0,
    });
  });
});

describe("countedFindings", () => {
  it("keeps only the newest review per agent, so a re-run does not double count", () => {
    const findings = countedFindings([
      review({
        id: "old",
        agent_id: "sec",
        created_at: "2026-06-10T10:00:00.000Z",
        findings: [finding({ id: "stale" })],
      }),
      review({
        id: "new",
        agent_id: "sec",
        created_at: "2026-06-11T10:00:00.000Z",
        findings: [finding({ id: "fresh" })],
      }),
    ]);
    expect(findings.map((f) => f.id)).toEqual(["fresh"]);
  });

  it("sums across different agents", () => {
    const findings = countedFindings([
      review({ id: "a", agent_id: "sec", findings: [finding({ id: "s1" })] }),
      review({ id: "b", agent_id: "perf", findings: [finding({ id: "p1" })] }),
    ]);
    expect(findings.map((f) => f.id).sort()).toEqual(["p1", "s1"]);
  });

  it("keeps every agent-less review — there is nothing to de-duplicate against", () => {
    const findings = countedFindings([
      review({ id: "a", agent_id: null, findings: [finding({ id: "x" })] }),
      review({ id: "b", agent_id: null, findings: [finding({ id: "y" })] }),
    ]);
    expect(findings.map((f) => f.id).sort()).toEqual(["x", "y"]);
  });

  it("ignores summary reviews — the list counts review findings only", () => {
    const findings = countedFindings([
      review({ id: "a", kind: "summary", agent_id: "sec", findings: [finding({ id: "sum" })] }),
    ]);
    expect(findings).toEqual([]);
  });

  it("does not depend on the order the endpoint returned reviews in", () => {
    const older = review({
      id: "old",
      agent_id: "sec",
      created_at: "2026-06-10T10:00:00.000Z",
      findings: [finding({ id: "stale" })],
    });
    const newer = review({
      id: "new",
      agent_id: "sec",
      created_at: "2026-06-11T10:00:00.000Z",
      findings: [finding({ id: "fresh" })],
    });
    expect(countedFindings([older, newer])).toEqual(countedFindings([newer, older]));
  });
});

describe("findingsOfSeverity", () => {
  it("returns only that severity, dismissed excluded", () => {
    const out = findingsOfSeverity(
      [
        finding({ id: "c", severity: "CRITICAL" }),
        finding({ id: "w", severity: "WARNING" }),
        finding({ id: "w-gone", severity: "WARNING", dismissed_at: "2026-06-11T12:00:00.000Z" }),
      ],
      "WARNING",
    );
    expect(out.map((f) => f.id)).toEqual(["w"]);
  });
});

describe("findingsByRun", () => {
  it("groups findings under the run that produced them", () => {
    const map = findingsByRun([
      review({ id: "a", run_id: "run-1", findings: [finding({ id: "f1" })] }),
      review({ id: "b", run_id: "run-2", findings: [finding({ id: "f2" })] }),
    ]);
    expect(map.get("run-1")?.map((f) => f.id)).toEqual(["f1"]);
    expect(map.get("run-2")?.map((f) => f.id)).toEqual(["f2"]);
  });

  it("skips reviews with no run — they have no timeline row to attach to", () => {
    const map = findingsByRun([
      review({ id: "a", run_id: null, findings: [finding({ id: "f1" })] }),
    ]);
    expect(map.size).toBe(0);
  });

  it("merges multiple reviews that share a run id", () => {
    const map = findingsByRun([
      review({ id: "a", run_id: "run-1", findings: [finding({ id: "f1" })] }),
      review({ id: "b", run_id: "run-1", findings: [finding({ id: "f2" })] }),
    ]);
    expect(map.get("run-1")?.map((f) => f.id)).toEqual(["f1", "f2"]);
  });
});

describe("totalCount / lineLabel", () => {
  it("sums the three buckets", () => {
    expect(totalCount({ CRITICAL: 2, WARNING: 1, SUGGESTION: 3 })).toBe(6);
  });

  it("collapses a single-line range", () => {
    expect(lineLabel({ start_line: 11, end_line: 11 })).toBe("11");
    expect(lineLabel({ start_line: 11, end_line: 15 })).toBe("11-15");
  });
});
