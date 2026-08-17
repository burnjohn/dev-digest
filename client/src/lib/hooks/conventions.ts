/* hooks/conventions.ts — React Query hooks for the L02 conventions extractor.
   Mirrors hooks/skills.ts: no per-hook error toasts, because the global
   MutationCache.onError in lib/providers.tsx already toasts every mutation
   failure (including the 409 you get when the repo has no code index yet). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionListResult,
  ConventionPatch,
  ConventionSkillDraft,
} from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionListResult>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/**
 * Run a scan. Synchronous on the server (one file-selection call + one per
 * category), so this mutation is genuinely pending for the duration — the page's
 * `scanning` state is driven by `isPending`, not by a polled job.
 *
 * The response IS the new list, so it is written straight into the cache rather
 * than invalidated: re-fetching would repeat a request we already have the answer
 * to, and the draft is stale either way once the candidate set changed.
 */
export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionListResult>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => {
      qc.setQueryData(["conventions", repoId], data);
      qc.invalidateQueries({ queryKey: ["convention-skill-draft", repoId] });
    },
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: ConventionPatch;
}

/**
 * Accept / reject / edit one candidate.
 *
 * Invalidates the draft as well as the list: the merged skill body is composed
 * from the accepted set, so accepting a rule — or editing an already-accepted
 * one's text — changes what the modal would open with.
 */
export function useUpdateConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
      qc.invalidateQueries({ queryKey: ["convention-skill-draft", repoId] });
    },
  });
}

/**
 * The pre-filled skill the create modal opens with. `enabled` is the modal's own
 * open state — the draft is a server-composed body, so fetching it while the modal
 * is closed would go stale the moment the user accepts another rule.
 */
export function useSkillDraft(repoId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["convention-skill-draft", repoId],
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: !!repoId && enabled,
  });
}

export interface LinkConventionsInput {
  ids: string[];
  skill_id: string;
}

/** Stamp `skill_id` on the rules that shipped in a just-created skill. */
export function useLinkConventionsToSkill(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkConventionsInput) =>
      api.post<{ ok: boolean }>(`/repos/${repoId}/conventions/skill-link`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["conventions", repoId] }),
  });
}
