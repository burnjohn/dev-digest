/* hooks/context.ts — React Query hooks for A3's Project Context (specs, index
   status with percentage progress, single-spec read/write). §12. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { IndexStatus, SpecFile } from "@devdigest/shared";

/** GET /repos/:id/context → list of spec files. */
export function useSpecs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-specs", repoId],
    queryFn: () => api.get<SpecFile[]>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

/** Index lifecycle statuses that mean a reindex is actively running. */
const RUNNING_STATUSES = ["parsing", "embedding", "cloning"];

/** GET /repos/:id/context/status → live IndexStatus. Polls while indexing. */
export function useIndexStatus(repoId: string | null | undefined, poll: boolean) {
  return useQuery({
    queryKey: ["context-status", repoId],
    queryFn: () => api.get<IndexStatus>(`/repos/${repoId}/context/status`),
    enabled: !!repoId,
    // Self-terminating poll: keep refetching only while the index is actively
    // running. Terminal states (done/idle/error) stop it — so a sticky "error"
    // (e.g. repo not cloned yet) can't loop forever.
    refetchInterval: (query) => {
      if (!poll) return false;
      const s = query.state.data?.status;
      return s && RUNNING_STATUSES.includes(s) ? 800 : false;
    },
  });
}

/** POST /repos/:id/context/reindex → enqueue indexing; returns initial status. */
export function useReindex(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<IndexStatus>(`/repos/${repoId}/context/reindex`),
    onSuccess: (status) => {
      qc.setQueryData(["context-status", repoId], status);
    },
  });
}

/** GET /context/:path?repoId → a single spec file (preview/edit). */
export function useSpecFile(repoId: string | null | undefined, path: string | null) {
  return useQuery({
    queryKey: ["context-file", repoId, path],
    queryFn: () =>
      api.get<SpecFile>(`/context/${path}?repoId=${encodeURIComponent(repoId!)}`),
    enabled: !!repoId && !!path,
    retry: false,
  });
}

/** PUT /context/:path {repoId, content} → save a spec file. */
export function useSaveSpec(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      api.put<SpecFile>(`/context/${path}`, { repoId, content }),
    onSuccess: (_d, { path }) => {
      qc.invalidateQueries({ queryKey: ["context-file", repoId, path] });
      qc.invalidateQueries({ queryKey: ["context-specs", repoId] });
    },
  });
}
