/* hooks/conventions.ts — React Query hooks for the Conventions Extractor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Convention, ConventionScan, ConventionSkillInput, Skill } from "@devdigest/shared";

// ---- Scans ----------------------------------------------------------------

export function useConventionScans(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", "scans", repoId],
    queryFn: ({ signal }) =>
      api.get<ConventionScan[]>(`/repos/${repoId}/conventions/scans`, { signal }),
    enabled: !!repoId,
    refetchInterval: (query) => {
      const scans = query.state.data;
      const running = scans?.some((s) => s.status === "running" || s.status === "pending");
      return running ? 2000 : false;
    },
  });
}

export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionScan>(`/repos/${repoId}/conventions/extract`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", "scans", repoId] });
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

// ---- Conventions (candidates) ----------------------------------------------

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: ({ signal }) =>
      api.get<Convention[]>(`/repos/${repoId}/conventions`, { signal }),
    enabled: !!repoId,
  });
}

export function usePatchConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      rule,
    }: {
      id: string;
      action: "accept" | "reject" | "edit" | "undo";
      rule?: string;
    }) => api.patch<Convention>(`/conventions/${id}`, { action, rule }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

// ---- Skill creation --------------------------------------------------------

export function useCreateConventionSkills(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConventionSkillInput) =>
      api.post<Skill[]>(`/repos/${repoId}/conventions/skills`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
