"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate, Skill } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () =>
      api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionCandidate[]>(
        `/repos/${repoId}/conventions/extract`,
        {},
      ),
    onSuccess: (_data, repoId) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export function useAcceptConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, id }: { repoId: string; id: string }) =>
      api.patch<ConventionCandidate>(`/repos/${repoId}/conventions/${id}`, {
        accepted: true,
      }),
    onSuccess: (_d, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export function useRejectConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, id }: { repoId: string; id: string }) =>
      api.patch<{ ok: boolean }>(`/repos/${repoId}/conventions/${id}`, {
        accepted: false,
      }),
    onSuccess: (_d, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export function useUpdateConventionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      repoId,
      id,
      rule,
    }: {
      repoId: string;
      id: string;
      rule: string;
    }) =>
      api.patch<ConventionCandidate>(`/repos/${repoId}/conventions/${id}`, {
        rule,
      }),
    onSuccess: (_d, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface CreateSkillFromConventionsInput {
  repoId: string;
  name: string;
  description: string;
}

export function useCreateSkillFromConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, ...body }: CreateSkillFromConventionsInput) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useImportSkillFromUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; name: string; description?: string }) =>
      api.post<Skill>("/skills/import-url", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
