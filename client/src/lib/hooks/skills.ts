/* hooks/skills.ts — React Query hooks for the Skills page, the skill editor,
   and the agent editor's Skills tab. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentSkillLink,
  Skill,
  SkillImportPreview,
  SkillImportPreviewBody,
  SkillStats,
  SkillVersion,
  CreateSkillBodyInput,
} from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

/**
 * The request shape, taken from the contract's INPUT side.
 *
 * `z.infer` is the POST-parse type, where every `.default()` field is required —
 * right for the handler, wrong for a caller that may omit them. `z.input` is the
 * one to build a request from, which is why this is not redeclared here.
 */
export type CreateSkillInput = CreateSkillBodyInput;

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">>;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      // A changed body bumps the version and snapshots a new one server-side
      // (renames/toggles don't) — invalidate rather than guess which happened.
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
      // A deleted skill silently drops out of every agent that linked it, so the
      // Skills tab's link lists are stale the moment this resolves.
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
    },
  });
}

/**
 * Extract a skill from an uploaded file. Persists NOTHING — the caller shows the
 * preview and, on confirmation, calls `useCreateSkill`. Deliberately not a
 * query: it is an action with a side-effect-free result, and caching it by
 * filename would re-show a stale preview for a re-picked file.
 */
export function useImportSkillPreview() {
  return useMutation({
    mutationFn: (input: SkillImportPreviewBody) =>
      api.post<SkillImportPreview>("/skills/import/preview", input),
  });
}

/** Skills linked to an agent, ordered — the agent editor's Skills tab. */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/**
 * Replace an agent's whole ordered skill set. Attach, detach and reorder are all
 * this one call — the server takes the array as the new truth and rewrites
 * `order` from the index, so the UI never has to compute an order value.
 *
 * OPTIMISTIC, and it has to be. The request replaces the WHOLE set, and the tab
 * computes each payload from the currently-cached links. Without an optimistic
 * write, a second toggle fired before the first response lands is built from the
 * pre-first-toggle state and overwrites it — a silent lost update, and double
 * -clicking is the natural thing to do when the checkbox does not move until the
 * round trip finishes.
 */
export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onMutate: async ({ agentId, skillIds }) => {
      const key = ["agent-skills", agentId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AgentSkillLink[]>(key);
      qc.setQueryData<AgentSkillLink[]>(
        key,
        skillIds.map((skillId, order) => ({ agent_id: agentId, skill_id: skillId, order })),
      );
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
    },
    onSuccess: (data, { agentId }) => {
      qc.setQueryData(["agent-skills", agentId], data);
    },
    onSettled: (_d, _e, { agentId }) => {
      // The count on the agent card is derived server-side from these links.
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
    },
  });
}

/** Ids of the agents currently linking a skill — the Stats tab's agent list. */
export function useSkillAgentIds(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-agents", skillId],
    queryFn: () => api.get<{ agent_ids: string[] }>(`/skills/${skillId}/agents`),
    enabled: !!skillId,
  });
}

/** Body history for a skill, newest version first — the Versions tab. */
export function useSkillVersions(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", skillId],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${skillId}/versions`),
    enabled: !!skillId,
  });
}

/**
 * Usage aggregates for the Stats tab — pull frequency, accept rate, findings by
 * category. `days` defaults server-side; passed explicitly here only when a
 * caller wants a non-default window (none does yet).
 */
export function useSkillStats(skillId: string | null | undefined, days?: number) {
  return useQuery({
    queryKey: ["skill-stats", skillId, days],
    queryFn: () =>
      api.get<SkillStats>(`/skills/${skillId}/stats${days ? `?days=${days}` : ""}`),
    enabled: !!skillId,
  });
}
