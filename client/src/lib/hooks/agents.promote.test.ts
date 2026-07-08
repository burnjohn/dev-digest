/**
 * usePromoteAgentPrompt — promotes an eval batch's agent_snapshot into a new
 * AgentVersion. Hermetic: `../api` is fully mocked, no running server.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
}));

import { api } from "../api";
import { usePromoteAgentPrompt } from "./agents";

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    Wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

beforeEach(() => {
  vi.mocked(api.post).mockReset();
});

describe("usePromoteAgentPrompt", () => {
  it("POSTs { batch_id } to /agents/:id/evals/promote and invalidates agent/version-history/eval-batches queries", async () => {
    const agentId = "agent-1";
    const batchId = "batch-1";
    const updatedAgent = {
      id: agentId,
      name: "Security Reviewer",
      description: "",
      provider: "openai",
      model: "gpt-5",
      system_prompt: "promoted prompt",
      enabled: true,
      version: 3,
      strategy: "single-pass",
      ci_fail_on: "critical",
      repo_intel: true,
    };
    vi.mocked(api.post).mockResolvedValueOnce(updatedAgent);
    const { Wrapper, queryClient } = wrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePromoteAgentPrompt(agentId), { wrapper: Wrapper });

    result.current.mutate(batchId);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith(`/agents/${agentId}/evals/promote`, { batch_id: batchId });
    expect(result.current.data).toEqual(updatedAgent);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent", agentId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agent-versions", agentId] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eval-batches", agentId] });
  });
});
