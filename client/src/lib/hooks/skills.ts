/* hooks/skills.ts — React Query hooks for the Skills page and the agent editor's
   Skills tab. A skill is reusable review guidance shared across agents: text and
   config only, never code. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentSkillDetail,
  Skill,
  SkillImportPreview,
  SkillSummary,
  SkillType,
  SkillVersion,
} from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<SkillSummary[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** Agents that link this skill — the Stats tab's "used by" panel. */
export function useSkillAgents(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-agents", id],
    queryFn: () => api.get<Array<{ id: string; name: string }>>(`/skills/${id}/agents`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source?: Skill["source"];
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">> & {
    /**
     * Author's note about what changed. Recorded on the version this save
     * writes — so it is ignored on an enabled-only toggle, which writes none.
     */
    version_message?: string;
  };
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
      // A body edit changes what every linked agent sends to the model.
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
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
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
    },
  });
}

/**
 * Parse an uploaded `.md` / `.zip` into a preview. This does NOT create a skill —
 * the user confirms the preview, then `useCreateSkill` persists it.
 */
export function useImportSkillPreview() {
  return useMutation({
    mutationFn: ({ filename, contentB64 }: { filename: string; contentB64: string }) =>
      api.post<SkillImportPreview>("/skills/import", {
        filename,
        content_b64: contentB64,
      }),
  });
}

// ---- agent ⇄ skill links -------------------------------------------------

/** Skills linked to an agent, in prompt order, with their per-link switch. */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillDetail[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/**
 * Link ONE skill to an agent, appended to whatever it already has. The single
 * `skill_id` form of the endpoint is additive — `useSetAgentSkills` replaces
 * the whole set, so it is the wrong call when you only mean "also use this".
 */
export function useLinkAgentSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillId }: { agentId: string; skillId: string }) =>
      api.post<unknown>(`/agents/${agentId}/skills`, { skill_id: skillId, enabled: true }),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export interface SetAgentSkillsInput {
  agentId: string;
  skills: Array<{ skill_id: string; enabled: boolean }>;
}

/**
 * Replace the agent's whole ordered skill set. Link order IS prompt order, and
 * a link change bumps the agent's config version, so the agent is refetched too.
 */
export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skills }: SetAgentSkillsInput) =>
      api.post<unknown>(`/agents/${agentId}/skills`, { skills }),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
