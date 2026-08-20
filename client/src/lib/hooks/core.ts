/* hooks/core.ts — typed React Query hooks over the F1 API (contracts):
   settings, secrets, repos, pulls, and project context. Scaffolding screens use
   these; feature-domain hooks live in the sibling files (agents/reviews/trace/…)
   and are re-exported alongside these from hooks/index.ts. */
"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { notify } from "../toast";
import type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  PrMeta,
  PrDetail,
  SpecFile,
  IndexStatus,
} from "../types";
import type { RepoWithToken } from "@devdigest/shared";

// ---- Settings (F1: GET/PUT /settings, POST /settings/test-connection) ----
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) => api.put<Settings>("/settings", patch),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function useTestConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnTestProvider | { provider: ConnTestProvider; key?: string }) => {
      const body = typeof input === "string" ? { provider: input } : input;
      return api.post<ConnTestResult>("/settings/test-connection", body);
    },
    // Saving/validating a provider key can change which models resolve — drop the
    // cached (possibly empty) model lists so the agent picker refetches, and
    // refresh the "Configured / Not set" key-status badges.
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ["provider-models"] });
        qc.invalidateQueries({ queryKey: ["secrets-status"] });
      }
    },
  });
}

/** Which provider keys are configured (booleans only — never the values). */
export function useSecretsStatus() {
  return useQuery({
    queryKey: ["secrets-status"],
    queryFn: () => api.get<SecretsStatus>("/settings/secrets-status"),
    staleTime: 30_000,
  });
}

// ---- Repos (F1: GET/POST /repos, refresh, delete) ----
/**
 * `GET /repos` returns `RepoWithToken[]` — every row carries `github_token_id`
 * and `github_token_label` (server: Task 8). Typed as such here so consumers
 * (the repo settings page, the PR-list "no token" badge) can read those
 * fields directly; `RepoWithToken` is a strict superset of the old `Repo`
 * shape, so nothing that only used base `Repo` fields breaks.
 */
export function useRepos() {
  return useQuery({
    queryKey: ["repos"],
    queryFn: () => api.get<RepoWithToken[]>("/repos"),
  });
}

/**
 * Body carries an optional `githubTokenId` so a repo can be bound to a token
 * at creation time. `null`/undefined omits `github_token_id` entirely — the
 * server then creates the repo with no token, same as before this field
 * existed. The response is `RepoWithToken` (server now joins the token label
 * into every repo row), a strict superset of the old `Repo` shape.
 *
 * Invalidates `["github-tokens"]` too, alongside `["repos"]`: binding a token
 * at creation (or re-adding an already-tracked repo with a NEW token, which
 * `RepoService.add`'s dedupe path now also assigns) changes that token's
 * `repo_count`, same as every sibling mutation that reassigns a token
 * (`useAssignRepoToken`, `useDeleteGitHubToken`, `usePatchGitHubToken`).
 */
export function useAddRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; githubTokenId: string | null }) =>
      api.post<RepoWithToken>("/repos", {
        url: input.url,
        ...(input.githubTokenId ? { github_token_id: input.githubTokenId } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repos"] });
      qc.invalidateQueries({ queryKey: ["github-tokens"] });
    },
  });
}

type JobStatus = { id: string; kind: string; status: string; error: string | null };

/**
 * Refresh a repo and follow the WORK, not the request.
 *
 * `POST /refresh` only queues jobs and answers in ~10ms, so a mutation's own
 * `isPending` is true for a few milliseconds while git runs for seconds. Bind a
 * button to that and it re-enables immediately, which is how rapid clicking
 * used to pile up concurrent fetches. `pending` here stays true until the job
 * reaches a terminal state, and a failure — a 403 on a private repo, say —
 * surfaces as a toast instead of vanishing behind the 200 the POST already
 * returned.
 */
export function useRefreshRepo() {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [repoId, setRepoId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ status: string; job_id: string }>(`/repos/${id}/refresh`),
    onSuccess: (data, id) => {
      setRepoId(id);
      setJobId(data.job_id ?? null);
    },
  });

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<JobStatus>(`/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) =>
      q.state.data && ["done", "failed"].includes(q.state.data.status) ? false : 700,
  });

  const status = job.data?.status;
  useEffect(() => {
    if (!jobId || !status || !["done", "failed"].includes(status)) return;
    if (status === "failed") {
      notify.error(job.data?.error?.split("\n")[0] ?? "Refresh failed");
    } else {
      qc.invalidateQueries({ queryKey: ["repos"] });
      if (repoId) {
        qc.invalidateQueries({ queryKey: ["pulls", repoId] });
        // The PR detail page reads by (repoId, number) now — refresh it too, or
        // a repo refresh updates the list while an open detail page stays stale.
        qc.invalidateQueries({ queryKey: ["pull-by-number", repoId] });
      }
    }
    setJobId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, status]);

  return {
    mutate: mutation.mutate,
    /** True from the click until the queued work settles — not just the POST. */
    isPending: mutation.isPending || !!jobId,
  };
}

export function useDeleteRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.del<{ deleted: string }>(`/repos/${repoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

// ---- Pull requests (F1: GET /repos/:id/pulls, GET /pulls/:id) ----
export function usePulls(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["pulls", repoId],
    queryFn: () => api.get<PrMeta[]>(`/repos/${repoId}/pulls`),
    enabled: !!repoId,
    // Auto-refresh PR statuses: re-sync from GitHub every 60s while the page is
    // open, and whenever the window regains focus.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePullDetail(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["pull", prId],
    queryFn: () => api.get<PrDetail>(`/pulls/${prId}`),
    enabled: prId != null,
  });
}

/**
 * Resolve a PR directly by its (repoId, number) route key — one request instead
 * of fetching the whole pulls list to find the row's uuid. The response body is
 * IDENTICAL to `GET /pulls/:id` (404 when unknown), so the result also seeds
 * the id-keyed `["pull", id]` cache: anything that later asks for the detail by
 * uuid gets an instant cache hit.
 */
export function usePullByNumber(repoId: string | null | undefined, number: number | null | undefined) {
  return useQuery({
    queryKey: ["pull-by-number", repoId, number],
    queryFn: () => api.get<PrDetail>(`/repos/${repoId}/pulls/number/${number}`),
    enabled: !!repoId && number != null && Number.isFinite(number),
  });
}

// ---- Project Context (A3 contract; safe to call once API exposes it) ----
export function useContextFiles(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<SpecFile[]>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

export function useReindexContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<IndexStatus>(`/repos/${repoId}/context/reindex`),
    onSuccess: (_d, repoId) => qc.invalidateQueries({ queryKey: ["context", repoId] }),
  });
}
