"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastResponse } from "@devdigest/shared";

/**
 * Fetch live blast-radius data for a PR.
 * Falls back to seed brief when the server endpoint returns available=false.
 *
 * Pattern mirrors usePrBrief in reviews.ts.
 */
export function useBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: ({ signal }) => api.get<BlastResponse>(`/pulls/${prId}/blast`, { signal }),
    enabled: !!prId,
    staleTime: 5 * 60 * 1000,
  });
}
