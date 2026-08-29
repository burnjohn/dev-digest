/**
 * helpers.test.ts — the skill Evals tab's pure transforms, asserted directly.
 * No rendering: these are plain functions, and the component test covers how
 * their output is composed into a row.
 *
 * The cases that matter are the ones the AGENT tab has no equivalent for: a
 * skill run's findings live in the ablation's WITH arm, and the without arm
 * has three shapes (ran / not_run / errored) that must not collapse to `0%`.
 */
import { describe, it, expect } from "vitest";
import type { EvalCaseRunResult } from "@devdigest/shared";
import type { EvalCaseListItem } from "@/lib/hooks/evals";
import {
  ablationPercents,
  caseRunMarker,
  expectationKindOf,
  isEmptyCase,
  passingSummary,
  runRecallPercent,
  skillFindingCount,
} from "./helpers";

const FINDING = {
  id: "f-1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded key",
  file: "snippet.ts",
  start_line: 1,
  end_line: 1,
  rationale: "A live key is checked in.",
  confidence: 0.95,
} as const;

function run(overrides: Partial<EvalCaseRunResult> = {}): EvalCaseRunResult {
  return {
    run_id: "run-1",
    case_id: "case-1",
    ran_at: "2026-08-29T00:00:00.000Z",
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    actual_output: {},
    ablation: {
      with: { recall: 1, precision: 1, citation_accuracy: 1, findings: [FINDING] },
      without: { recall: 0.5, findings: [] },
    },
    duration_ms: 1200,
    cost_usd: 0.01,
    ...overrides,
  };
}

function item(overrides: Partial<EvalCaseListItem> = {}): EvalCaseListItem {
  return {
    id: "case-1",
    owner_kind: "skill",
    owner_id: "skill-1",
    name: "a-case",
    expectation_kind: "must_find",
    input_diff: "--- a/snippet.ts\n+++ b/snippet.ts",
    input_files: null,
    input_meta: null,
    expected_output: [
      { severity: "CRITICAL", category: "security", title: "t", start_line: 1, end_line: 1, file: "snippet.ts" },
    ],
    forbidden_regions: null,
    filename: "snippet.ts",
    notes: null,
    latest_run: null,
    ...overrides,
  };
}

describe("caseRunMarker", () => {
  it("is 'never' with no run, and otherwise mirrors the run's pass", () => {
    expect(caseRunMarker(item())).toBe("never");
    expect(caseRunMarker(item({ latest_run: run({ pass: true }) }))).toBe("pass");
    expect(caseRunMarker(item({ latest_run: run({ pass: false }) }))).toBe("fail");
  });

  it("reads a null `pass` (an errored run) as 'fail', never as a third state", () => {
    expect(caseRunMarker(item({ latest_run: run({ pass: null }) }))).toBe("fail");
  });
});

describe("skillFindingCount", () => {
  it("counts the WITH arm's findings — not `actual_output`, which holds the ablation object", () => {
    expect(skillFindingCount(run())).toBe(1);
  });

  it("is 0 for a run with no ablation at all, rather than throwing", () => {
    expect(skillFindingCount(run({ ablation: null }))).toBe(0);
    expect(skillFindingCount(null)).toBe(0);
  });
});

describe("runRecallPercent", () => {
  it("rounds to a whole percent, and is null when the run recorded no recall", () => {
    expect(runRecallPercent(run({ recall: 0.666 }))).toBe(67);
    expect(runRecallPercent(run({ recall: null }))).toBeNull();
    expect(runRecallPercent(null)).toBeNull();
  });
});

describe("ablationPercents", () => {
  it("returns both arms as whole percents when the without arm ran", () => {
    expect(ablationPercents(run())).toEqual({ with: 100, without: 50 });
  });

  it("reports an unrun without arm as null — a single-case run never runs it, and 0% would libel the baseline", () => {
    const notRun = run({
      ablation: { with: { recall: 1, precision: 1, citation_accuracy: 1, findings: [] }, without: { unavailable: "not_run" } },
    });
    expect(ablationPercents(notRun)).toEqual({ with: 100, without: null });
  });

  it("reports an errored without arm as null too — AC-65's second absence, not a zero", () => {
    const errored = run({
      ablation: {
        with: { recall: 0.5, precision: 1, citation_accuracy: 1, findings: [] },
        without: { unavailable: "errored", reason: "provider key missing" },
      },
    });
    expect(ablationPercents(errored)).toEqual({ with: 50, without: null });
  });

  it("is null for a run with no ablation, so the caller renders no suffix at all", () => {
    expect(ablationPercents(run({ ablation: null }))).toBeNull();
    expect(ablationPercents(null)).toBeNull();
  });

  it("keeps a null recall on an arm that RAN distinct from 0", () => {
    const nullRecall = run({
      ablation: {
        with: { recall: null, precision: 1, citation_accuracy: 1, findings: [] },
        without: { recall: 0, findings: [] },
      },
    });
    expect(ablationPercents(nullRecall)).toEqual({ with: null, without: 0 });
  });
});

describe("isEmptyCase / expectationKindOf", () => {
  it("treats a non-empty expected_output as must_find even if the stored kind disagrees", () => {
    const legacy = item({ expectation_kind: "must_not_flag" });
    expect(isEmptyCase(legacy)).toBe(false);
    expect(expectationKindOf(legacy)).toBe("must_find");
  });

  it("falls back to the stored kind only for a case with no expectations", () => {
    const empty = item({ expected_output: [], expectation_kind: "must_not_flag" });
    expect(isEmptyCase(empty)).toBe(true);
    expect(expectationKindOf(empty)).toBe("must_not_flag");
  });
});

describe("passingSummary", () => {
  it("counts only cases whose latest run passed; never-run and failed both miss", () => {
    expect(
      passingSummary([
        item({ id: "a", latest_run: run({ pass: true }) }),
        item({ id: "b", latest_run: run({ pass: false }) }),
        item({ id: "c", latest_run: null }),
      ]),
    ).toEqual({ passed: 1, total: 3 });
  });

  it("is 0/0 for an empty list rather than dividing by nothing", () => {
    expect(passingSummary([])).toEqual({ passed: 0, total: 0 });
  });
});
