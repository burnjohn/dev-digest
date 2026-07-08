/**
 * Cross-Agent Eval Dashboard hooks — useEvalOverview / useEvalRecentAcrossAgents /
 * useRunAllAgents. Hermetic: `../api` is fully mocked, no running server.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from "../api";
import { useEvalOverview, useEvalRecentAcrossAgents, useRunAllAgents } from "./eval";

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    Wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
});

describe("useEvalOverview", () => {
  it("fetches /evals/overview and returns the agent summary rows", async () => {
    const rows = [
      {
        agent_id: "a1",
        agent_name: "Security Reviewer",
        model: "gpt-5",
        latest_batch: null,
        sparkline_points: [],
        case_count: 3,
      },
    ];
    vi.mocked(api.get).mockResolvedValueOnce(rows);
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useEvalOverview(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/evals/overview", expect.anything());
    expect(result.current.data).toEqual(rows);
  });
});

describe("useEvalRecentAcrossAgents", () => {
  it("fetches /evals/recent and returns the cross-agent batch rows", async () => {
    const rows = [
      {
        batch: {
          id: "b1",
          agent_id: "a1",
          kind: "full",
          status: "clean",
          agent_snapshot: {},
          recall: 0.9,
          precision: 0.8,
          citation_accuracy: 1,
          cost_usd: 0.01,
          ran_at: "2026-07-07T00:00:00Z",
          system_prompt_snapshot: null,
        },
        agent_id: "a1",
        agent_name: "Security Reviewer",
        pass_count: 9,
        total_count: 10,
      },
    ];
    vi.mocked(api.get).mockResolvedValueOnce(rows);
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useEvalRecentAcrossAgents(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith("/evals/recent", expect.anything());
    expect(result.current.data).toEqual(rows);
  });
});

describe("useRunAllAgents", () => {
  it("POSTs /evals/run-all and invalidates both dashboard queries on success", async () => {
    const response = { started: [{ agent_id: "a1", batch_id: "b1" }] };
    vi.mocked(api.post).mockResolvedValueOnce(response);
    const { Wrapper, queryClient } = wrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRunAllAgents(), { wrapper: Wrapper });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith("/evals/run-all");
    expect(result.current.data).toEqual(response);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eval-overview"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eval-recent"] });
  });
});
