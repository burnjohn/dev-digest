/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Agent,
  AgentContextDocLink,
  AgentSkillLink,
  AgentStats,
  AgentVersion,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from "@devdigest/shared";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.get<Agent>(`/agents/${id}`),
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

/** Config history for an agent, newest version first (Versions tab). Mirrors
 *  `useSkillVersions` exactly — same shape, same `GET .../versions` route
 *  convention (`server/src/modules/agents/routes.ts:128`, already wired). */
export function useAgentVersions(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-versions", agentId],
    queryFn: () => api.get<AgentVersion[]>(`/agents/${agentId}/versions`),
    enabled: !!agentId,
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
    queryFn: () => api.get<ModelInfo[]>(`/providers/${provider}/models`),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/** Replace the whole ordered set of linked skills for an agent. */
export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (data) => {
      qc.setQueryData(["agent-skills", agentId], data);
      qc.invalidateQueries({ queryKey: ["agents"] }); // refresh skillCount on the AgentCard
    },
  });
}

// ---- Project Context (SPEC-01) — Agent editor Context tab ----------------

export function useAgentContextDocs(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context-docs", agentId],
    queryFn: () => api.get<AgentContextDocLink[]>(`/agents/${agentId}/context-docs`),
    enabled: !!agentId,
  });
}

/** Replace the whole ordered set of attached docs for an agent (AC-4b, AC-6). */
export function useSetAgentContextDocs(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docs: { repo_id: string; path: string }[]) =>
      api.post<AgentContextDocLink[]>(`/agents/${agentId}/context-docs`, { docs }),
    onSuccess: (data) => {
      qc.setQueryData(["agent-context-docs", agentId], data);
      // Not an unscoped invalidateQueries() — scoped to the exact
      // "repo-context-docs" query-key head only (SPEC-02 NFR). The mutation
      // response only reflects the NEW set, so a fully-detached repo would
      // be missing from it; a predicate on the query key catches that case
      // too, unlike diffing `data`/`variables` against the old cache.
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "repo-context-docs" });
    },
  });
}

/** Optional explicit period for `useAgentStats`/`useAgentsStats` (Agent
 *  Performance dashboard). Both ISO datetime strings — omitted entirely
 *  (the default, zero-arg call shape used by the Stats tab) means "let the
 *  server apply its own trailing-30-days default". */
export interface StatsRange {
  since?: string;
  until?: string;
}

function statsQueryString(range?: StatsRange): string {
  if (!range) return "";
  const params = new URLSearchParams();
  if (range.since) params.set("since", range.since);
  if (range.until) params.set("until", range.until);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useAgentStats(agentId: string | null | undefined, range?: StatsRange) {
  return useQuery({
    // Range included in the key so different periods don't collide in the
    // cache; `since`/`until` both undefined (the Stats tab's call shape)
    // collapses back to the exact same key the Stats tab has always used.
    queryKey: ["agent-stats", agentId, range?.since, range?.until],
    queryFn: () => api.get<AgentStats>(`/agents/${agentId}/stats${statsQueryString(range)}`),
    enabled: !!agentId,
  });
}

/** Stats for a SET of agents at once (SPEC-07 T10, Configure run screen's
 *  cost/time estimate — needs every workspace agent's `avg_cost_usd`/
 *  `avg_latency_ms` at once, not just the checked ones, since each row shows
 *  its own "no run history" state regardless of check state). Also backs
 *  the global Agent Performance dashboard's period picker (`range`) — the
 *  ONLY data fetch that page does; no second, dashboard-only aggregator.
 *  One query per id via `useQueries` — calling `useAgentStats` inside a
 *  `.map()` would violate the rules of hooks here (the number of workspace
 *  agents can change across renders); same pattern as `useSkillsContextDocs`
 *  (`hooks/skills.ts`). Uses the SAME query key shape as `useAgentStats` so
 *  the cache is shared with the Agent Editor's Stats tab for the same
 *  agent/period. */
export function useAgentsStats(
  agentIds: string[],
  range?: StatsRange,
): { data: Map<string, AgentStats>; isLoading: boolean; isError: boolean; refetch: () => void } {
  const results = useQueries({
    queries: agentIds.map((agentId) => ({
      queryKey: ["agent-stats", agentId, range?.since, range?.until],
      queryFn: () => api.get<AgentStats>(`/agents/${agentId}/stats${statsQueryString(range)}`),
    })),
  });
  const map = new Map<string, AgentStats>();
  for (let i = 0; i < agentIds.length; i++) {
    const agentId = agentIds[i];
    const stats = results[i]?.data;
    if (!agentId || !stats) continue;
    map.set(agentId, stats);
  }
  return {
    data: map,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    refetch: () => results.forEach((r) => r.refetch()),
  };
}
