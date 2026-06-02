/* hooks/multiagent.ts — A5 Multi-Agent Review (§12).
   POST /pulls/:id/multi-agent-run (run all enabled agents in parallel + built-in
   Lethal-Trifecta), GET /pulls/:id/multi-agent (latest assembled run). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MultiAgentRun } from "@devdigest/shared/contracts/observability";

/** Latest assembled multi-agent run for a PR (columns + conflicts). */
export function useMultiAgentRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent", prId],
    queryFn: () => api.get<MultiAgentRun>(`/pulls/${prId}/multi-agent`),
    enabled: !!prId,
    retry: false,
  });
}

export interface RunMultiAgentInput {
  prId: string;
  agentIds?: string[];
  includeTrifecta?: boolean;
}

/** Kick off a parallel multi-agent review; returns the assembled run. */
export function useRunMultiAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds, includeTrifecta }: RunMultiAgentInput) =>
      api.post<MultiAgentRun>(`/pulls/${prId}/multi-agent-run`, {
        ...(agentIds ? { agentIds } : {}),
        ...(includeTrifecta !== undefined ? { includeTrifecta } : {}),
      }),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["multi-agent", prId] });
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
    },
  });
}
