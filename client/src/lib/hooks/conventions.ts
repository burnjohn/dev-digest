/* hooks/conventions.ts — React Query hooks for the A1 Conventions extractor (§12). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts?: { provider?: "openai" | "anthropic"; model?: string }) =>
      api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`, opts ?? {}),
    onSuccess: (data) => qc.setQueryData(["conventions", repoId], data),
  });
}

export function useAcceptConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conventionId: string) =>
      api.post<{ accepted: boolean; skill_id: string }>(`/conventions/${conventionId}/accept`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
