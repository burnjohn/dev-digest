import { describe, it, expect } from "vitest";
import type { EvalCase, EvalCaseOutcome } from "@devdigest/shared/contracts/knowledge";
import { effectByCaseId, isAllZeroLift, originByCaseId, outcomesByCaseId } from "./helpers";

function evalCase(id: string, sourceFindingId: string | null): EvalCase {
  return {
    id,
    owner_kind: "skill",
    owner_id: "skill-1",
    name: id,
    input_diff: "d",
    input_files: ["f"],
    input_meta: { pr_number: null, title: "t", body: null },
    expectation: { type: "must_find", file: "f", start_line: 1, end_line: 1, severity: null, category: null, title: null },
    source_finding_id: sourceFindingId,
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function outcome(caseId: string): EvalCaseOutcome {
  return {
    case_id: caseId,
    name: caseId,
    expectation_type: "must_find",
    status: "scored",
    pass: true,
    error_reason: null,
    findings_total: 1,
    findings_matched: 1,
    grounding_kept: 1,
    grounding_total: 1,
    duration_ms: 1,
    cost_usd: 0.001,
    actual: [],
  };
}

describe("originByCaseId", () => {
  it("AC-35 — maps a case with a source_finding_id to 'finding' and a hand-authored one (null) to 'hand'", () => {
    const map = originByCaseId([evalCase("c1", "finding-1"), evalCase("c2", null)]);
    expect(map.get("c1")).toBe("finding");
    expect(map.get("c2")).toBe("hand");
  });

  it("returns an empty map for undefined input", () => {
    expect(originByCaseId(undefined).size).toBe(0);
  });
});

describe("outcomesByCaseId", () => {
  it("keys the with-arm's per_case outcomes by case id", () => {
    const run = { metrics: { per_case: [outcome("c1"), outcome("c2")] } };
    const map = outcomesByCaseId(run);
    expect(map.size).toBe(2);
    expect(map.get("c1")?.case_id).toBe("c1");
  });

  it("returns an empty map when the run is null, or its metrics are null", () => {
    expect(outcomesByCaseId(null).size).toBe(0);
    expect(outcomesByCaseId({ metrics: null }).size).toBe(0);
  });
});

describe("effectByCaseId", () => {
  it("keys each effect entry by case id, omitting cases the run never classified", () => {
    const run = { effects: [{ case_id: "c1", effect: "helped" as const }] };
    const map = effectByCaseId(run);
    expect(map.get("c1")).toBe("helped");
    expect(map.has("c2")).toBe(false);
  });

  it("returns an empty map for a null run", () => {
    expect(effectByCaseId(null).size).toBe(0);
  });
});

describe("isAllZeroLift", () => {
  it("AC-41 — true only when every metric is present and exactly zero", () => {
    expect(isAllZeroLift({ recall: 0, precision: 0, citation_accuracy: 0 })).toBe(true);
  });

  it("false when lift is null/undefined (not-applicable, AC-22's case — never conflated with all-zero)", () => {
    expect(isAllZeroLift(null)).toBe(false);
    expect(isAllZeroLift(undefined)).toBe(false);
  });

  it("false when any metric is null (not-applicable) even if the others are zero", () => {
    expect(isAllZeroLift({ recall: 0, precision: null, citation_accuracy: 0 })).toBe(false);
  });

  it("false when any metric is nonzero", () => {
    expect(isAllZeroLift({ recall: 0.25, precision: 0, citation_accuracy: 0 })).toBe(false);
  });
});
