/* hooks/compose.ts — React Query hooks for the A4 Compose Review drawer (§12). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ComposedReview,
  ComposeReviewInputBody,
  ComposeReviewPreview,
} from "@devdigest/shared/contracts/eval-ci";

export function useComposedReviews(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["composed-reviews", prId],
    queryFn: () => api.get<ComposedReview[]>(`/pulls/${prId}/compose-reviews`),
    enabled: !!prId,
  });
}

/** Compose a draft body (no GitHub side-effect) to seed the editor. */
export function useComposePreview() {
  return useMutation({
    mutationFn: ({ prId, input }: { prId: string; input: ComposeReviewInputBody }) =>
      api.post<ComposeReviewPreview>(`/pulls/${prId}/compose-review/preview`, input),
  });
}

/** Post the composed review to GitHub via PAT and persist it. */
export function usePostComposeReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, input }: { prId: string; input: ComposeReviewInputBody }) =>
      api.post<ComposedReview>(`/pulls/${prId}/compose-review`, input),
    onSuccess: (_d, { prId }) =>
      qc.invalidateQueries({ queryKey: ["composed-reviews", prId] }),
  });
}
