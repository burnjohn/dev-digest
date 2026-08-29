import { describe, it, expect } from "vitest";
import { EVAL_BATCH_CONCURRENCY, type EvalBatchDetail, type EvalBatchRecord } from "@devdigest/shared";
import { batchCaseStates, formatBatchFraction, isBatchNonTerminal } from "./eval-batch";

function batch(over: Partial<EvalBatchRecord> = {}): EvalBatchRecord {
  return {
    id: "batch-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    owner_version: 1,
    runner_agent_id: null,
    runner_agent_version: null,
    started_at: "2026-08-28T00:00:00Z",
    finished_at: null,
    status: "running",
    recall: null,
    precision: null,
    citation_accuracy: null,
    cases_passed: 0,
    cases_total: 5,
    cost_usd: null,
    ...over,
  };
}

describe("formatBatchFraction", () => {
  it("is empty before any detail has loaded, else cases-attempted over cases_total", () => {
    expect(formatBatchFraction(null)).toBe("");
    const detail: EvalBatchDetail = { ...batch(), cases: [] };
    expect(formatBatchFraction(detail)).toBe("0/5");
    const detail2: EvalBatchDetail = {
      ...batch(),
      cases: [
        { case_id: "1", case_name: "a", errored: false, pass: true, recall: 1, precision: 1, citation_accuracy: 1, skill_lift: null },
      ],
    };
    expect(formatBatchFraction(detail2)).toBe("1/5");
  });

  // Mutation this kills: printing `cases_total` raw. `eval_run_batches`
  // carried a NULL total until the batch finished, coalesced to `0` on the
  // wire, so the studio's progress line read `5/0` for the whole run.
  it("falls back to the caller's own case count when the batch reports a total of 0", () => {
    const detail: EvalBatchDetail = { ...batch(), cases_total: 0, cases: [] };
    expect(formatBatchFraction(detail, 11)).toBe("0/11");
    expect(formatBatchFraction(detail)).toBe("0/0");
  });
});

describe("isBatchNonTerminal", () => {
  it("REQ-17/AC-18: only 'running' is non-terminal", () => {
    expect(isBatchNonTerminal("running")).toBe(true);
    expect(isBatchNonTerminal("succeeded")).toBe(false);
    expect(isBatchNonTerminal("partial")).toBe(false);
    expect(isBatchNonTerminal("failed")).toBe(false);
    expect(isBatchNonTerminal(undefined)).toBe(false);
  });
});

describe("batchCaseStates", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const detail = (scored: string[]) => ({ cases: scored.map((id) => ({ case_id: id })) });
  const running = (states: Map<string, string>) => [...states.values()].filter((v) => v === "running");

  it("no batch running: nothing is marked, whatever the detail says", () => {
    expect(batchCaseStates(ids, detail(["a"]), false).size).toBe(0);
  });

  // Mutation this kills: spinning every unscored case. The server's pool is
  // bounded, so only EVAL_BATCH_CONCURRENCY of them hold a live LLM call.
  it("marks exactly EVAL_BATCH_CONCURRENCY unscored cases as running and queues the rest", () => {
    const states = batchCaseStates(ids, detail(["a"]), true);
    expect(states.get("a")).toBeUndefined();
    expect(running(states)).toHaveLength(EVAL_BATCH_CONCURRENCY);
    expect(states.get("b")).toBe("running");
    expect(states.get("e")).toBe("queued");
  });

  it("a just-started batch with no results yet fills the pool from the top of the list", () => {
    const states = batchCaseStates(ids, undefined, true);
    expect(states.get("a")).toBe("running");
    expect(running(states)).toHaveLength(EVAL_BATCH_CONCURRENCY);
  });

  it("a tail shorter than the pool leaves no queued cases at all", () => {
    const states = batchCaseStates(ids, detail(["a", "b", "c", "d"]), true);
    expect(states.get("e")).toBe("running");
    expect([...states.values()].filter((v) => v === "queued")).toHaveLength(0);
  });

  it("scored membership — not position — decides who is done, so out-of-order results still read right", () => {
    const states = batchCaseStates(ids, detail(["c", "a"]), true);
    expect(states.has("a")).toBe(false);
    expect(states.has("c")).toBe(false);
    expect(states.get("b")).toBe("running");
  });

  it("every result landing leaves nothing marked, even before the poll turns terminal", () => {
    expect(batchCaseStates(ids, detail(ids), true).size).toBe(0);
  });
});
