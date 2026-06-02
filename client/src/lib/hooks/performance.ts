/* hooks/performance.ts — A6 Agent Performance (§12). GET /agents/performance →
   per-agent accept-rate / cost / latency aggregates, sorted by accept-rate. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentPerf } from "@devdigest/shared";

export function useAgentPerformance() {
  return useQuery({
    queryKey: ["agent-performance"],
    queryFn: () => api.get<AgentPerf>("/agents/performance"),
  });
}
