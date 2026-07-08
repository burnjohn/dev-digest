/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Agent, AgentCardStats, ModelInfo, Provider, ReviewStrategy } from "@devdigest/shared";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: ({ signal }) => api.get<Agent[]>("/agents", { signal }),
  });
}

/** Per-agent usage stats (runs · accept% · avg cost · skills) for the list cards. */
export function useAgentStats() {
  return useQuery({
    queryKey: ["agent-stats"],
    queryFn: ({ signal }) => api.get<AgentCardStats[]>("/agents/stats", { signal }),
    staleTime: 30_000,
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: ({ signal }) => api.get<Agent>(`/agents/${id}`, { signal }),
    enabled: !!id,
  });
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  enabled?: boolean;
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>("/agents", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export interface UpdateAgentInput {
  id: string;
  patch: Partial<
    Pick<
      Agent,
      | "name"
      | "description"
      | "provider"
      | "model"
      | "system_prompt"
      | "output_schema"
      | "strategy"
      | "ci_fail_on"
      | "repo_intel"
      | "enabled"
    >
  >;
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/agents/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.removeQueries({ queryKey: ["agent", id] });
    },
  });
}

/** Dynamic model list for a provider (editor model picker). */
export function useProviderModels(provider: Provider | null | undefined) {
  return useQuery({
    queryKey: ["provider-models", provider],
    queryFn: ({ signal }) => api.get<ModelInfo[]>(`/providers/${provider}/models`, { signal }),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

/**
 * Promote an eval batch's frozen `agent_snapshot` into a new `AgentVersion`
 * (Agent Eval Dashboard). On success, invalidate every query keyed off this
 * agent's config/version-history/eval-batches — the promoted version changes
 * all three (new current config, new version-history row, and the promoting
 * batch's own detail no longer shows as "not yet promoted").
 */
export function usePromoteAgentPrompt(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) =>
      api.post<Agent>(`/agents/${agentId}/evals/promote`, { batch_id: batchId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-versions", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-batches", agentId] });
    },
  });
}
