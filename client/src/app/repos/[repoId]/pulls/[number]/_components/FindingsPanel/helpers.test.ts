import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { severityCounts, visibleFindings } from "./helpers";

function finding(over: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "security",
    title: "t",
    file: "src/a.ts",
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
    ...over,
  };
}

const FINDINGS: FindingRecord[] = [
  finding({ id: "s1", severity: "SUGGESTION" }),
  finding({ id: "c1", severity: "CRITICAL" }),
  finding({ id: "w1", severity: "WARNING" }),
  finding({ id: "c2", severity: "CRITICAL", confidence: 0.3 }),
];

describe("severityCounts", () => {
  it("counts per severity in severity order, omitting absent ones", () => {
    expect(severityCounts(FINDINGS)).toEqual([
      ["CRITICAL", 2],
      ["WARNING", 1],
      ["SUGGESTION", 1],
    ]);
  });

  it("returns an empty list for no findings", () => {
    expect(severityCounts([])).toEqual([]);
  });
});

describe("visibleFindings severity filter", () => {
  it("keeps only the selected severity", () => {
    const shown = visibleFindings(FINDINGS, false, "CRITICAL");
    expect(shown.map((f) => f.id)).toEqual(["c1", "c2"]);
  });

  it("no filter keeps everything, sorted by severity", () => {
    const shown = visibleFindings(FINDINGS, false, null);
    expect(shown.map((f) => f.severity)).toEqual([
      "CRITICAL",
      "CRITICAL",
      "WARNING",
      "SUGGESTION",
    ]);
  });

  it("composes with hide-low-confidence", () => {
    const shown = visibleFindings(FINDINGS, true, "CRITICAL");
    expect(shown.map((f) => f.id)).toEqual(["c1"]);
  });
});
