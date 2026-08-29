import { describe, it, expect } from "vitest";
import type { EvalAblationOutput } from "@devdigest/shared";
import { appendSkillFindingSkeleton, computeSkillLift, formatSkillLift } from "./skill-helpers";

function ablation(over: Partial<EvalAblationOutput> = {}): EvalAblationOutput {
  return {
    with: { recall: 0.8, precision: 0.9, citation_accuracy: 1, findings: [] },
    without: { recall: 0.6, findings: [] },
    ...over,
  };
}

describe("appendSkillFindingSkeleton", () => {
  it("REQ-55: appends a skeleton with no `file` key, from empty or existing text", () => {
    const appended = JSON.parse(appendSkillFindingSkeleton("[]"));
    expect(appended).toHaveLength(1);
    expect("file" in appended[0]).toBe(false);
    expect(appended[0]).toMatchObject({ severity: "WARNING", category: "bug", title: "" });

    const existing = JSON.stringify([{ severity: "CRITICAL", category: "security", title: "x", start_line: 1, end_line: 1 }]);
    const appendedTwice = JSON.parse(appendSkillFindingSkeleton(existing));
    expect(appendedTwice).toHaveLength(2);
    expect("file" in appendedTwice[1]).toBe(false);
  });

  it("falls back to a fresh one-element array on unparsable text", () => {
    const appended = JSON.parse(appendSkillFindingSkeleton("not json"));
    expect(appended).toHaveLength(1);
    expect("file" in appended[0]).toBe(false);
  });
});

describe("computeSkillLift / formatSkillLift", () => {
  it("REQ-67: both arms complete — a signed numeric lift, never 0 by accident", () => {
    const a = ablation();
    expect(computeSkillLift(a)).toBeCloseTo(0.2);
    expect(formatSkillLift(a)).toBe("+20%");
  });

  it("REQ-67: a negative lift renders with a minus sign, a zero lift renders \"0%\"", () => {
    expect(formatSkillLift(ablation({ with: { recall: 0.5, precision: null, citation_accuracy: null, findings: [] } }))).toBe("-10%");
    expect(formatSkillLift(ablation({ with: { recall: 0.6, precision: null, citation_accuracy: null, findings: [] } }))).toBe("0%");
  });

  it("REQ-67: \"—\", never \"0\", when `with.recall` is null", () => {
    const a = ablation({ with: { recall: null, precision: null, citation_accuracy: null, findings: [] } });
    expect(computeSkillLift(a)).toBeNull();
    expect(formatSkillLift(a)).toBe("—");
  });

  it("REQ-67: \"—\" when the without arm never ran", () => {
    const a = ablation({ without: { unavailable: "not_run" } });
    expect(computeSkillLift(a)).toBeNull();
    expect(formatSkillLift(a)).toBe("—");
  });

  it("REQ-67: \"—\" when the without arm errored", () => {
    const a = ablation({ without: { unavailable: "errored", reason: "timeout" } });
    expect(computeSkillLift(a)).toBeNull();
    expect(formatSkillLift(a)).toBe("—");
  });

  it("REQ-67: \"—\" when the without arm ran but its recall is null", () => {
    const a = ablation({ without: { recall: null, findings: [] } });
    expect(computeSkillLift(a)).toBeNull();
    expect(formatSkillLift(a)).toBe("—");
  });

  it("REQ-67: \"—\" for a null ablation object", () => {
    expect(computeSkillLift(null)).toBeNull();
    expect(formatSkillLift(null)).toBe("—");
  });
});
