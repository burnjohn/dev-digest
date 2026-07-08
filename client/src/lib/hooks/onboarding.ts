/* hooks/onboarding.ts — React Query hooks for the Onboarding Tour feature.
   GET  /repos/:id/onboarding          → persisted (or well-formed empty) tour
   POST /repos/:id/onboarding/generate → regenerate (single LLM call), returns
                                          the refreshed tour synchronously. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { OnboardingTour } from "@devdigest/shared";

/** Persisted (or never-generated placeholder) onboarding tour for a repo. */
export function useOnboardingTour(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: ({ signal }) => api.get<OnboardingTour>(`/repos/${repoId}/onboarding`, { signal }),
    enabled: !!repoId,
    staleTime: 5 * 60 * 1000,
  });
}

/** Distinguishes a 429 (rate-limited) generate failure from any other error. */
export function isRateLimitedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

/** Regenerate the onboarding tour (single LLM call). On success, updates the
    ["onboarding", repoId] cache directly with the fresh tour so the page
    re-renders without a second fetch round-trip. */
export function useGenerateOnboardingTour(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!repoId) throw new Error("repoId required");
      return api.post<OnboardingTour>(`/repos/${repoId}/onboarding/generate`);
    },
    onSuccess: (data) => {
      qc.setQueryData(["onboarding", repoId], data);
    },
  });
}
