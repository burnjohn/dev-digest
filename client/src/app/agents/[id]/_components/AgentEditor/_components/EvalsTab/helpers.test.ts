import { describe, it, expect } from "vitest";
import type { EvalBatchRecord } from "@devdigest/shared";
import type { EvalCaseListItem } from "@/lib/hooks/evals";
import {
  actualFindingCount,
  caseRunMarker,
  formatMetricPercent,
  formatTracesPassed,
  expectationKindOf,
  isEmptyCase,
  passingSummary,
  runAllDisabledReason,
} from "./helpers";

function caseItem(over: Partial<EvalCaseListItem> = {}): EvalCaseListItem {
  return {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "case-1",
    expectation_kind: "must_find",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [
      { severity: "CRITICAL", category: "security", title: "x", start_line: 1, end_line: 1, file: "a.ts" },
    ],
    forbidden_regions: null,
    filename: null,
    notes: null,
    latest_run: null,
    ...over,
  };
}

function batch(over: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    id: "batch-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    owner_version: 1,
    runner_agent_id: null,
    runner_agent_version: null,
    started_at: "2026-08-28T00:00:00Z",
    finished_at: "2026-08-28T00:05:00Z",
    status: "succeeded",
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 1,
    cases_passed: 4,
    cases_total: 5,
    cost_usd: 0.1,
    ...over,
  };
}

describe("caseRunMarker", () => {
  it("REQ-9: a case with no eval_runs row marks 'never'", () => {
    expect(caseRunMarker(caseItem({ latest_run: null }))).toBe("never");
  });

  it("REQ-8: a persisted run marks 'pass' or 'fail' from its own pass field", () => {
    const run = {
      run_id: "r1",
      case_id: "case-1",
      ran_at: "2026-08-28T00:00:00Z",
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      actual_output: [],
      ablation: null,
      duration_ms: 100,
      cost_usd: 0.01,
    };
    expect(caseRunMarker(caseItem({ latest_run: run }))).toBe("pass");
    expect(caseRunMarker(caseItem({ latest_run: { ...run, pass: false } }))).toBe("fail");
  });
});

describe("actualFindingCount", () => {
  it("counts the agent arm's actual_output array directly", () => {
    const run = {
      run_id: "r1",
      case_id: "case-1",
      ran_at: "x",
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      actual_output: [{ a: 1 }, { a: 2 }],
      ablation: null,
      duration_ms: 100,
      cost_usd: 0.01,
    };
    expect(actualFindingCount(run)).toBe(2);
  });

  it("is 0 for no run and for a non-array actual_output", () => {
    expect(actualFindingCount(null)).toBe(0);
    expect(actualFindingCount(undefined)).toBe(0);
  });
});

describe("formatMetricPercent / formatTracesPassed — AC-25 never 0%", () => {
  it("renders — for null, a rounded percent otherwise", () => {
    expect(formatMetricPercent(null)).toBe("—");
    expect(formatMetricPercent(undefined)).toBe("—");
    expect(formatMetricPercent(0.833)).toBe("83%");
    expect(formatMetricPercent(0)).toBe("0%"); // a REAL zero still renders 0%, only null is —
  });

  it("REQ-25: renders — for all four figures when there is no terminal batch yet", () => {
    expect(formatTracesPassed(null)).toBe("—");
    expect(formatTracesPassed(undefined)).toBe("—");
  });

  it("renders n/m once a terminal batch exists", () => {
    expect(formatTracesPassed(batch({ cases_passed: 3, cases_total: 5 }))).toBe("3/5");
  });
});

describe("isEmptyCase", () => {
  it("AC-46: a must_not_flag case with no expectations is empty", () => {
    expect(isEmptyCase(caseItem({ expected_output: [] }))).toBe(true);
    expect(isEmptyCase(caseItem())).toBe(false);
  });
});

describe("expectationKindOf — the row pill's arm", () => {
  it("AC-46: reports the stored kind for a case with no expectations", () => {
    expect(expectationKindOf(caseItem({ expected_output: [], expectation_kind: "must_not_flag" }))).toBe(
      "must_not_flag",
    );
  });

  it("AC-43: reports must_find for a case that stores expectations", () => {
    expect(expectationKindOf(caseItem({ expectation_kind: "must_find" }))).toBe("must_find");
  });

  // Mutation this kills: `return item.expectation_kind`. A legacy row whose
  // `eval_cases.expectation_kind` column is NULL is served as `must_not_flag`
  // by `evals/helpers.ts` even when findings are stored beside it — reading
  // the field raw would render a MUST NOT FLAG pill next to a CRITICAL badge.
  it("lets a non-empty expected_output override a contradictory stored kind", () => {
    expect(expectationKindOf(caseItem({ expectation_kind: "must_not_flag" }))).toBe("must_find");
  });
});

describe("passingSummary", () => {
  it("counts only cases whose latest run passed", () => {
    const passed = { pass: true } as EvalCaseListItem["latest_run"];
    const failed = { pass: false } as EvalCaseListItem["latest_run"];
    const items = [
      caseItem({ id: "a", latest_run: passed }),
      caseItem({ id: "b", latest_run: failed }),
      caseItem({ id: "c", latest_run: null }),
    ];
    expect(passingSummary(items)).toEqual({ passed: 1, total: 3 });
  });
});


describe("runAllDisabledReason", () => {
  const copy = { emptySetReason: "empty", inFlightReason: "in-flight" };

  it("REQ-13: an empty set is disabled with its own reason, ahead of an in-flight batch", () => {
    expect(runAllDisabledReason(0, true, copy)).toBe("empty");
    expect(runAllDisabledReason(0, false, copy)).toBe("empty");
  });

  it("REQ-13: a non-empty set with a live batch is disabled with the in-flight reason", () => {
    expect(runAllDisabledReason(3, true, copy)).toBe("in-flight");
  });

  it("is enabled (null) once there are cases and nothing running", () => {
    expect(runAllDisabledReason(3, false, copy)).toBeNull();
  });
});

