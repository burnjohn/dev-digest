/* hooks/stats.ts — A5 Per-agent Stats (§12). GET /agents/:id/stats →
   accept/dismiss rate, findings volume, cost + latency aggregates. The
   accept-rate is the headline quality signal (§7). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { AgentStats } from "@devdigest/shared/contracts/observability";

export function useAgentStats(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-stats", agentId],
    queryFn: () => api.get<AgentStats>(`/agents/${agentId}/stats`),
    enabled: !!agentId,
  });
}
