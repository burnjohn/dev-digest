/* hooks/github-tokens.ts — per-repo GitHub token hooks (server: Tasks 1-8).
   Vocabulary is "token", never "credential". A token VALUE must only ever be
   sent to POST /github-tokens, PATCH /github-tokens/:id, or POST
   /github-tokens/test — every other mutation here sends only an id (or
   nothing at all, for useTestRepoAccess: the server resolves the repo's own
   stored token, so no value ever leaves the browser for that route). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GitHubToken,
  GitHubTokenInput,
  GitHubTokenPatch,
  GitHubTokenTestInput,
  GitHubTokenTestResult,
  RepoWithToken,
} from "@devdigest/shared";
import { api } from "../api";

const TOKENS_KEY = ["github-tokens"];

/** GET /github-tokens — list this workspace's tokens. Never includes the value. */
export function useGitHubTokens() {
  return useQuery({
    queryKey: TOKENS_KEY,
    queryFn: () => api.get<GitHubToken[]>("/github-tokens"),
  });
}

/** POST /github-tokens — 422 if GitHub rejects the PAT or the label is taken. */
export function useCreateGitHubToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GitHubTokenInput) => api.post<GitHubToken>("/github-tokens", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: TOKENS_KEY }),
  });
}

/**
 * PATCH /github-tokens/:id — rename, replace the value, or both.
 *
 * `RepoWithToken.github_token_label` is computed server-side per repo from the
 * live token row (`server/src/modules/repos/helpers.ts:69`) rather than
 * denormalized onto the repo — so a rename leaves every dependent repo's
 * cached label stale until `["repos"]` is invalidated too. Replacing the
 * value alone only flips `configured`, which no repo field depends on, but
 * one invalidation covering both cases is simpler than branching on which
 * fields the patch touched and costs nothing extra (an unaffected `["repos"]`
 * refetch just returns the same data).
 */
export function usePatchGitHubToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: GitHubTokenPatch & { id: string }) =>
      api.patch<GitHubToken>(`/github-tokens/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TOKENS_KEY });
      qc.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

/**
 * DELETE /github-tokens/:id — always succeeds; affected repos go to
 * `github_token_id: null` server-side. That means every repo pointing at this
 * token just changed underneath us, so `["repos"]` must be invalidated too or
 * the token badge on those repos would keep showing the deleted token until
 * some unrelated refetch happened to occur.
 */
export function useDeleteGitHubToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.del<{ deleted: string; orphaned_repos: number }>(`/github-tokens/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TOKENS_KEY });
      qc.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

/**
 * POST /github-tokens/test — ephemeral, persists nothing, rate limited 20/min.
 * Only mutation (besides create/patch) that ever sends a raw token value.
 */
export function useTestGitHubToken() {
  return useMutation({
    mutationFn: (input: GitHubTokenTestInput) =>
      api.post<GitHubTokenTestResult>("/github-tokens/test", input),
  });
}

/**
 * POST /repos/:id/test-access — resolves the repo's OWN stored token
 * server-side. Sends an empty body: no token value ever goes from the
 * browser for this route, which is the whole reason it exists instead of
 * reusing useTestGitHubToken.
 */
export function useTestRepoAccess() {
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<GitHubTokenTestResult>(`/repos/${repoId}/test-access`),
  });
}

/**
 * PATCH /repos/:id/github-token — assign/clear a repo's token. 404 if the
 * repo id is not the caller's; 422 if the chosen token cannot read the repo.
 * Invalidates repos (the badge/label changed) and the tokens list (repo_count
 * moved from one token to another).
 */
export function useAssignRepoToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, githubTokenId }: { repoId: string; githubTokenId: string | null }) =>
      api.patch<RepoWithToken>(`/repos/${repoId}/github-token`, { github_token_id: githubTokenId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repos"] });
      qc.invalidateQueries({ queryKey: TOKENS_KEY });
    },
  });
}
