/* hooks/conventions.ts — React Query hooks for the repo-scoped Conventions page. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate, ConventionScan } from "@devdigest/shared";

/** Current scan for a repo — no LLM call. Never-scanned repos get an empty scan. */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionScan>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** Runs one extraction pass — config files + top-ranked source files → cheap-model candidates. */
export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionScan>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => qc.setQueryData(["conventions", repoId], data),
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: { accepted?: boolean; rule?: string; category?: string };
}

/** Accept/reject toggle and/or rule/category edit — one PATCH for both. */
export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (updated) => {
      qc.setQueryData<ConventionScan | undefined>(["conventions", repoId], (prev) =>
        prev
          ? { ...prev, candidates: prev.candidates.map((c) => (c.id === updated.id ? updated : c)) }
          : prev,
      );
    },
  });
}
