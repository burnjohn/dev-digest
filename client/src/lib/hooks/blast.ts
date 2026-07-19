/* hooks/blast.ts — Blast Radius (L04).
   Fetch the deterministic impact map for a PR from GET /pulls/:id/blast.
   No LLM, no streaming — a cheap projection over the prebuilt repo-intel index,
   so it's a plain cached GET (long staleTime; changes only when the PR's files do). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius } from "@devdigest/shared";

/** Blast radius for a PR. Free/deterministic → cache aggressively, no polling. */
export function useBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
    staleTime: 5 * 60_000,
  });
}
