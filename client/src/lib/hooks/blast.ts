/* hooks/blast.ts — `GET /pulls/:id/blast` (docs/plans/06-blast-radius.md).
   "What else could this diff touch?" — symbols declared in the PR's changed
   files, who calls them, and which endpoints/cron jobs may depend on the
   changed code. Modelled on `useSmartDiff` (hooks/reviews.ts): the response
   is recomputed server-side on every request and persisted nowhere, so no
   `refetchInterval` and no `staleTime` override belong here either. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse } from "@devdigest/shared";

export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}
