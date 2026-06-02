/* hooks/brief.ts — React Query hooks for A3's PR Brief, Blast radius and
   git-why (§12). Types come from @devdigest/shared. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius, PrBrief } from "@devdigest/shared";
import type { WhyTimeline } from "@devdigest/shared/contracts/why";

/** GET /pulls/:id/brief → Intent + Blast + Risks + History (persisted). */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<PrBrief>(`/pulls/${prId}/brief`),
    enabled: !!prId,
    retry: false,
  });
}

/** GET /pulls/:id/blast → BlastRadius (changed symbols + downstream). */
export function usePrBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
    retry: false,
  });
}

/** GET /pulls/:id/why?file&line → WhyTimeline for a specific line. */
export function usePrWhy(
  prId: string | null | undefined,
  loc: { file: string; line: number } | null,
) {
  return useQuery({
    queryKey: ["why", prId, loc?.file, loc?.line],
    queryFn: () =>
      api.get<WhyTimeline>(
        `/pulls/${prId}/why?file=${encodeURIComponent(loc!.file)}&line=${loc!.line}`,
      ),
    enabled: !!prId && !!loc,
    retry: false,
  });
}
