/* hooks/skills.ts — React Query hooks for the Skills Lab feature. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Skill, AgentSkillLink } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: string;
  body: string;
}

export interface ImportSkillInput {
  name: string;
  body: string;
  source?: string;
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<
    Pick<Skill, "name" | "description" | "type" | "body" | "enabled">
  >;
}

export interface SkillStats {
  agent_count: number;
  pull_frequency_pct: number;
  accept_rate_pct: number;
  findings_30d: number;
  agents: Array<{ id: string; name: string }>;
  findings_by_category: Record<string, number>;
}

export interface SkillVersionRow {
  version: number;
  body: string;
  created_at: string;
}

export interface RestoreSkillInput {
  skillId: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Skills CRUD
// ---------------------------------------------------------------------------

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

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export function useImportSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportSkillInput) =>
      api.post<Skill>("/skills/import", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) =>
      api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
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
    },
  });
}

// ---------------------------------------------------------------------------
// Skill stats + versions
// ---------------------------------------------------------------------------

export function useSkillStats(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", id],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersionRow[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export function useRestoreSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, version }: RestoreSkillInput) =>
      api.post<Skill>(`/skills/${skillId}/restore`, { version }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill", data.id] });
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

// ---------------------------------------------------------------------------
// Agent ↔ Skills linking
// ---------------------------------------------------------------------------

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      agentId,
      skill_ids,
    }: {
      agentId: string;
      skill_ids: string[];
    }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
