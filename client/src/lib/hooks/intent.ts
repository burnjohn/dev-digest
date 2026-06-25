/* hooks/intent.ts — React Query hooks for PR intent (classifier output). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntentRecord } from "@devdigest/shared";

/** Fetch the intent for a PR (lazily computed server-side on first access). */
export function useIntent(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["intent", prId],
    queryFn: () => api.get<PrIntentRecord>(`/pulls/${prId}/intent`),
    enabled: prId != null,
  });
}

/** Trigger a fresh intent computation for a PR and update the cache on success. */
export function useRecomputeIntent(prId: string | number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent/recompute`),
    onSuccess: (data) => qc.setQueryData(["intent", prId], data),
  });
}
