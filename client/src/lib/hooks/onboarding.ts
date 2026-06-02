/* hooks/onboarding.ts — React Query hooks for A3's Onboarding generator (§12). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Onboarding } from "@devdigest/shared";

/** GET /repos/:id/onboarding → persisted Onboarding (5 sections). 404 if none. */
export function useOnboarding(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () => api.get<Onboarding>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
    retry: false,
  });
}

/** POST /repos/:id/onboarding/generate → regenerate the tour via RAG. */
export function useGenerateOnboarding(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Onboarding>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: (data) => {
      qc.setQueryData(["onboarding", repoId], data);
    },
  });
}
