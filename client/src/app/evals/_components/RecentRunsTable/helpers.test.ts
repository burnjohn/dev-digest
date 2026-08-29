import { describe, it, expect } from "vitest";
import type { Agent, EvalBatchRecord, EvalOwnerDashboard } from "@devdigest/shared";
import { flattenRecentRuns, type JoinedAgentRow } from "./helpers";

function agent(id: string, name: string): Agent {
  return {
    id,
    name,
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "x",
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skill_count: 0,
  };
}

function batch(id: string, startedAt: string, ownerId = "a1"): EvalBatchRecord {
  return {
    id,
    owner_kind: "agent",
    owner_id: ownerId,
    owner_version: 3,
    runner_agent_id: null,
    runner_agent_version: null,
    started_at: startedAt,
    finished_at: startedAt,
    status: "succeeded",
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.95,
    cases_passed: 4,
    cases_total: 4,
    cost_usd: 0.1,
  };
}

function joined(agentId: string, name: string, batches: EvalBatchRecord[]): JoinedAgentRow {
  const row: EvalOwnerDashboard = {
    owner_kind: "agent",
    owner_id: agentId,
    cases_total: batches.length,
    latest_batch: batches[0] ?? null,
    delta: { recall: null, precision: null, citation_accuracy: null },
    trend: [],
    recent_batches: batches,
    alert: null,
  };
  return { row, agent: agent(agentId, name) };
}

describe("flattenRecentRuns", () => {
  it("interleaves batches from different agents strictly by started_at desc", () => {
    // Each agent's own history is already newest-first; the point is that the
    // MERGE is by timestamp, not by agent, so a naive concat would fail this.
    const rows = [
      joined("a1", "Security Reviewer", [
        batch("b-late", "2026-05-29T09:00:00.000Z", "a1"),
        batch("b-early", "2026-05-25T09:00:00.000Z", "a1"),
      ]),
      joined("a2", "Perf Reviewer", [batch("b-mid", "2026-05-27T09:00:00.000Z", "a2")]),
    ];

    expect(flattenRecentRuns(rows, 10).map((r) => r.batch.id)).toEqual([
      "b-late",
      "b-mid",
      "b-early",
    ]);
  });

  it("tags every batch with its own agent's id and name", () => {
    const rows = [
      joined("a1", "Security Reviewer", [batch("b1", "2026-05-29T09:00:00.000Z", "a1")]),
      joined("a2", "Perf Reviewer", [batch("b2", "2026-05-28T09:00:00.000Z", "a2")]),
    ];

    expect(flattenRecentRuns(rows, 10).map((r) => [r.batch.id, r.agentId, r.agentName])).toEqual([
      ["b1", "a1", "Security Reviewer"],
      ["b2", "a2", "Perf Reviewer"],
    ]);
  });

  it("breaks a started_at tie on id desc, mirroring the server's own ordering", () => {
    const rows = [
      joined("a1", "Security Reviewer", [
        batch("b-aaa", "2026-05-29T09:00:00.000Z", "a1"),
        batch("b-zzz", "2026-05-29T09:00:00.000Z", "a1"),
      ]),
    ];

    expect(flattenRecentRuns(rows, 10).map((r) => r.batch.id)).toEqual(["b-zzz", "b-aaa"]);
  });

  it("truncates to the limit, keeping the NEWEST rather than the first seen", () => {
    const rows = [
      joined("a1", "Security Reviewer", [batch("b-old", "2026-05-20T09:00:00.000Z", "a1")]),
      joined("a2", "Perf Reviewer", [batch("b-new", "2026-05-29T09:00:00.000Z", "a2")]),
    ];

    expect(flattenRecentRuns(rows, 1).map((r) => r.batch.id)).toEqual(["b-new"]);
  });

  it("contributes nothing for an agent that has never run, and nothing at all for no agents", () => {
    expect(flattenRecentRuns([joined("a1", "Security Reviewer", [])], 10)).toEqual([]);
    expect(flattenRecentRuns([], 10)).toEqual([]);
  });

  it("returns an empty feed for a non-positive limit instead of slicing from the end", () => {
    // `slice(0, -1)` would drop only the last row — silently showing almost
    // everything where the caller asked for nothing.
    const rows = [joined("a1", "Security Reviewer", [batch("b1", "2026-05-29T09:00:00.000Z")])];
    expect(flattenRecentRuns(rows, 0)).toEqual([]);
    expect(flattenRecentRuns(rows, -3)).toEqual([]);
  });
});
