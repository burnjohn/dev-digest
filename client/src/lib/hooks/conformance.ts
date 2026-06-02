/* hooks/conformance.ts — React Query hooks for A4 PRD↔PR Conformance (§12). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type {
  ConformanceInput,
  ConformanceReport,
} from "@devdigest/shared/contracts/eval-ci";

/** Latest persisted conformance report for a PR (404 → null, not an error). */
export function useConformance(prId: string | null | undefined, spec?: string) {
  const q = spec ? `?spec=${encodeURIComponent(spec)}` : "";
  return useQuery({
    queryKey: ["conformance", prId, spec ?? null],
    enabled: !!prId,
    retry: false,
    queryFn: async () => {
      try {
        return await api.get<ConformanceReport>(`/pulls/${prId}/conformance${q}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useRunConformance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, input }: { prId: string; input?: ConformanceInput }) =>
      api.post<ConformanceReport>(`/pulls/${prId}/conformance`, input ?? {}),
    onSuccess: (_d, { prId }) =>
      qc.invalidateQueries({ queryKey: ["conformance", prId] }),
  });
}
