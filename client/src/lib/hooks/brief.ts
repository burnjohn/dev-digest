/* hooks/brief.ts — `POST /pulls/:id/brief` (server/specs/SPEC-02-pr-risk-brief.md).
   One model call produces a `what` / `why` / `risk_level` / `risks[]` /
   `review_focus[]` judgement about a PR, cached on `pr_brief` keyed on `pr_id`
   alone. Modelled on `usePrIntent`/`useReclassifyIntent` (hooks/reviews.ts). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { RiskBriefResponse } from "@devdigest/shared";

/**
 * Get-or-create the PR's risk brief.
 *
 * Deliberately a POST inside a `queryFn`, not a GET — do not "fix" this to a
 * GET. `POST /pulls/:id/brief` is get-or-create and cache-first ON THE
 * SERVER: a row already exists → it is returned with zero model calls; no
 * row → exactly one generation. There is no `GET /pulls/:id/brief`, so a GET
 * here would 404 for every PR that has never been reviewed. Mounting the
 * card is what makes the brief exist.
 *
 * Two components mount this hook — `PrBriefCard` and `ReviewFocusCard` — and
 * the shared `["pr-brief", prId]` query key is what collapses them into one
 * request instead of two independent POSTs. `staleTime: Infinity` + no
 * refetch-on-focus keep a refocus from re-POSTing once the card has its
 * answer for this session.
 */
export function usePrBrief(prId: string | null) {
  return useQuery({
    queryKey: ["pr-brief", prId],
    queryFn: () => api.post<RiskBriefResponse>(`/pulls/${prId}/brief`, {}),
    enabled: !!prId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** Force a fresh brief (the Recalculate control, and only that control — no
    auto-refresh exists). Writes straight into the `usePrBrief` cache entry
    via `setQueryData` — never `invalidateQueries` — so the fresh brief is
    applied without a second round trip. `isPending` disables the control. */
export function useRecalculateBrief(prId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RiskBriefResponse>(`/pulls/${prId}/brief`, { force: true }),
    onSuccess: (data) => {
      qc.setQueryData(["pr-brief", prId], data);
    },
  });
}
