"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate, PromoteResult } from "@devdigest/shared";

export type { ConventionCandidate, PromoteResult };

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useAcceptConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cid: string) =>
      api.post<ConventionCandidate>(`/repos/${repoId}/conventions/${cid}/accept`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useRejectConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cid: string) =>
      api.post<ConventionCandidate>(`/repos/${repoId}/conventions/${cid}/reject`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function useUpdateConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cid, patch }: { cid: string; patch: { rule?: string; category?: string } }) =>
      api.put<ConventionCandidate>(`/repos/${repoId}/conventions/${cid}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}

export function usePromoteConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoUrl, name, description }: { repoUrl: string; name?: string; description?: string }) =>
      api.post<PromoteResult>(`/repos/${repoId}/conventions/promote`, { repo_url: repoUrl, name, description }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}
