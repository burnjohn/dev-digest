/* hooks/conventions.ts — React Query hooks for the Conventions Extractor.
   A candidate is a PROPOSED house-rule with verified evidence: the user accepts
   or rejects each one, and the accepted set becomes a skill. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionExtractResult,
  ConventionSkillDraft,
  ConventionStatus,
} from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/**
 * Run a scan. Costs one model call, so it is a mutation, never a query — it
 * must not re-run on a refocus. The response already contains the full new
 * board, so it seeds the list cache instead of triggering a refetch.
 */
export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionExtractResult>(`/repos/${repoId}/conventions/extract`, {}),
    onSuccess: (data, repoId) => {
      qc.setQueryData(["conventions", repoId], data.candidates);
    },
  });
}

export interface UpdateConventionInput {
  repoId: string;
  id: string;
  patch: { rule?: string; rationale?: string | null; status?: ConventionStatus };
}

export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (updated, { repoId }) => {
      qc.setQueryData<ConventionCandidate[]>(["conventions", repoId], (prev) =>
        prev?.map((c) => (c.id === updated.id ? updated : c)),
      );
    },
  });
}

export function useDeleteConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { repoId: string; id: string }) =>
      api.del<{ ok: boolean }>(`/conventions/${id}`),
    onSuccess: (_d, { repoId, id }) => {
      qc.setQueryData<ConventionCandidate[]>(["conventions", repoId], (prev) =>
        prev?.filter((c) => c.id !== id),
      );
    },
  });
}

/**
 * Assemble the accepted candidates into a skill draft. Writes nothing — the
 * modal edits the draft and `useCreateSkill` persists it, the same
 * preview-then-confirm flow skill import uses.
 */
export function useConventionSkillDraft() {
  return useMutation({
    mutationFn: ({ repoId, conventionIds }: { repoId: string; conventionIds?: string[] }) =>
      api.post<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill`, {
        ...(conventionIds ? { convention_ids: conventionIds } : {}),
      }),
  });
}
