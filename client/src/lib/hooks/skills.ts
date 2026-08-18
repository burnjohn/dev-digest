/* hooks/skills.ts — React Query hooks for the A1 Skills Lab + the agent editor's
   Skills tab. Mirrors hooks/agents.ts: no per-hook error toasts, because the
   global MutationCache.onError in lib/providers.tsx already toasts every
   mutation failure. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  AgentSkillLink,
  Skill,
  SkillListItem,
  SkillSource,
  SkillType,
  SkillVersion,
} from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<SkillListItem[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

/** Body snapshots, newest first. Only the Versions tab needs these. */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
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
  // `version_message` is a request-only field — it labels the snapshot the save
  // writes, and is not part of `Skill`. Intersected locally rather than added to
  // the shared contract, consistent with this type already being local.
  patch: Partial<Pick<Skill, "name" | "description" | "type" | "body" | "enabled">> & {
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
      // A body edit writes a new snapshot, so the history is stale either way.
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

/**
 * Restore an old body as a new version.
 *
 * Posts a version NUMBER, never a body: the server reads the snapshot itself,
 * under the same row lock a save takes. Sending `{ body }` from this cache is
 * exactly the lost update this endpoint exists to prevent — and it is also why
 * no `staleTime` guard is needed here, since a stale version list can only fail
 * to offer a newer version, never write a wrong one.
 *
 * A restore IS a save, so it invalidates precisely what `useUpdateSkill` does.
 * NOT `["agent-skills"]`: no links change.
 */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post<Skill>(`/skills/${id}/restore`, { version }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
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
      qc.removeQueries({ queryKey: ["skill-versions", id] });
      // Deleting cascades through agent_skills, so every agent's link list and
      // the cards' skill counts can change.
      qc.invalidateQueries({ queryKey: ["agent-skills"] });
      qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

/** Ordered skill links for one agent (`order` ASC — this is prompt order). */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/**
 * Replace an agent's whole ordered link set in one request.
 *
 * Invalidates `["agents"]` as well as `["agent-skills", id]`: this writes through
 * a different endpoint than `useUpdateAgent`, so nothing else would refresh the
 * `skill_count` on the agent cards. It also bumps the agent's version server-side,
 * so the agent itself is stale.
 */
export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (data) => {
      qc.setQueryData(["agent-skills", agentId], data);
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
    },
  });
}
