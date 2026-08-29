import { describe, it, expect } from "vitest";
import type { EvalExpectedFinding } from "@devdigest/shared";
import {
  appendFindingSkeleton,
  buildEvalCaseWrite,
  deriveExpectationKind,
  formatActualOutput,
  formatDurationSeconds,
  formatMetricPercent,
  getInputTabs,
  isEvalCaseRecord,
  positiveBannerFinding,
  safeParseExpectedOutput,
} from "./helpers";

const finding = (over: Partial<EvalExpectedFinding> = {}): EvalExpectedFinding => ({
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  start_line: 12,
  end_line: 12,
  file: "src/config.ts",
  ...over,
});

describe("isEvalCaseRecord", () => {
  it("is true for a persisted record (has id) and false for a draft/null", () => {
    expect(isEvalCaseRecord({ id: "c1" } as never)).toBe(true);
    expect(isEvalCaseRecord({ owner_kind: "agent" } as never)).toBe(false);
    expect(isEvalCaseRecord(null)).toBe(false);
    expect(isEvalCaseRecord(undefined)).toBe(false);
  });
});

describe("deriveExpectationKind — REQ-43/44, badge flips on emptiness alone", () => {
  it("reads must_not_flag for blank or a bare empty array", () => {
    expect(deriveExpectationKind("")).toBe("must_not_flag");
    expect(deriveExpectationKind("   ")).toBe("must_not_flag");
    expect(deriveExpectationKind("[]")).toBe("must_not_flag");
  });

  it("flips to must_find the instant the text is non-empty and isn't [] — even invalid JSON", () => {
    expect(deriveExpectationKind("[")).toBe("must_find");
    expect(deriveExpectationKind(JSON.stringify([finding()], null, 2))).toBe("must_find");
  });

  it("flips back to must_not_flag when emptied again", () => {
    expect(deriveExpectationKind(JSON.stringify([finding()]))).toBe("must_find");
    expect(deriveExpectationKind("[]")).toBe("must_not_flag");
  });
});

describe("safeParseExpectedOutput", () => {
  it("parses a valid JSON array of findings", () => {
    const result = safeParseExpectedOutput(JSON.stringify([finding()]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it("rejects unparseable text and non-array JSON", () => {
    expect(safeParseExpectedOutput("{not json")).toEqual({ ok: false });
    expect(safeParseExpectedOutput("{}")).toEqual({ ok: false });
  });
});

describe("appendFindingSkeleton", () => {
  it("appends a blank finding to an existing valid array", () => {
    const next = appendFindingSkeleton(JSON.stringify([finding()]));
    const parsed = JSON.parse(next);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual({ severity: "WARNING", category: "bug", title: "", file: "", start_line: 1, end_line: 1 });
  });

  it("recovers into a fresh one-element array when the current text is invalid", () => {
    const next = appendFindingSkeleton("not json at all");
    expect(JSON.parse(next)).toHaveLength(1);
  });
});

describe("positiveBannerFinding — REQ-48's MUST find copy source", () => {
  it("reads the first expected finding when the JSON is valid and non-empty", () => {
    const f = positiveBannerFinding(JSON.stringify([finding({ title: "Race condition" }), finding()]));
    expect(f?.title).toBe("Race condition");
  });

  it("is undefined for invalid JSON or an empty array — the banner falls back to blanks, not stale data", () => {
    expect(positiveBannerFinding("[")).toBeUndefined();
    expect(positiveBannerFinding("[]")).toBeUndefined();
  });
});

describe("buildEvalCaseWrite", () => {
  it("never sends expectation_kind — it is not a field of the built payload at all", () => {
    const payload = buildEvalCaseWrite({
      ownerKind: "agent",
      ownerId: "agent-1",
      name: "  stripe-key-leak  ",
      inputDiff: "--- a/x\n+++ b/x",
      expectedOutput: [finding()],
      forbiddenRegions: null,
    });
    expect(payload).not.toHaveProperty("expectation_kind");
    expect(payload.name).toBe("stripe-key-leak");
    expect(payload.owner_kind).toBe("agent");
    expect(payload.expected_output).toHaveLength(1);
  });

  it("FIX-2: an agent-owned payload (inputFiles/filename omitted) carries no input_files/filename key at all", () => {
    const payload = buildEvalCaseWrite({
      ownerKind: "agent",
      ownerId: "agent-1",
      name: "stripe-key-leak",
      inputDiff: "--- a/x\n+++ b/x",
      expectedOutput: [finding()],
      forbiddenRegions: null,
    });
    expect(payload).not.toHaveProperty("input_files");
    expect(payload).not.toHaveProperty("filename");
  });

  it("FIX-2/REQ-56/57/59: a skill-owned payload transmits the authored input_files + filename", () => {
    const payload = buildEvalCaseWrite({
      ownerKind: "skill",
      ownerId: "skill-1",
      name: "hardcoded-secret",
      inputDiff: "",
      expectedOutput: [],
      forbiddenRegions: null,
      inputFiles: { kind: "modified_file", filename: "src/index.ts", before: "const x = 1;", after: "const x = 2;" },
      filename: "src/index.ts",
    });
    expect(payload.input_files).toEqual({
      kind: "modified_file",
      filename: "src/index.ts",
      before: "const x = 1;",
      after: "const x = 2;",
    });
    expect(payload.filename).toBe("src/index.ts");
  });
});

describe("formatActualOutput — REQ-49", () => {
  it("returns null (never run yet) for no run, and pretty JSON otherwise", () => {
    expect(formatActualOutput(null)).toBeNull();
    const run = { actual_output: { findings: [] } } as never;
    expect(formatActualOutput(run)).toBe(JSON.stringify({ findings: [] }, null, 2));
  });
});

describe("formatMetricPercent / formatDurationSeconds", () => {
  it("renders null metrics as — (AC-25: never a fake 0)", () => {
    expect(formatMetricPercent(null)).toBe("—");
    expect(formatMetricPercent(0.92)).toBe("92");
    expect(formatDurationSeconds(null)).toBe("—");
    expect(formatDurationSeconds(1800)).toBe("1.8");
  });
});

describe("getInputTabs — REQ-53/54, the one call site T20 extends", () => {
  it("wires Diff enabled and Files/PR meta disabled with the PR-meta reason key, for an agent case", () => {
    const tabs = getInputTabs("agent");
    expect(tabs.find((tb) => tb.key === "diff")).toMatchObject({ disabled: false });
    expect(tabs.find((tb) => tb.key === "files")).toMatchObject({ disabled: true });
    const prMeta = tabs.find((tb) => tb.key === "pr_meta");
    expect(prMeta).toMatchObject({ disabled: true, disabledReasonKey: "tabs.prMetaDisabledReason" });
  });
});
