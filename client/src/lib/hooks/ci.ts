/* hooks/ci.ts — React Query hooks for A4 Export-to-CI + CI Runs (§12). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CiExport,
  CiExportInputBody,
  CiInstallation,
  CiRun,
} from "@devdigest/shared/contracts/eval-ci";

export function useCiRuns(opts?: { ingest?: boolean }) {
  const q = opts?.ingest === false ? "?ingest=false" : "";
  return useQuery({
    queryKey: ["ci-runs", opts ?? null],
    queryFn: () => api.get<CiRun[]>(`/ci-runs${q}`),
    refetchInterval: 30_000, // local-first polling reflected in the UI
  });
}

export function useCiInstallations() {
  return useQuery({
    queryKey: ["ci-installations"],
    queryFn: () => api.get<CiInstallation[]>("/ci-installations"),
  });
}

export function useExportToCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInputBody }) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
      qc.invalidateQueries({ queryKey: ["ci-runs"] });
    },
  });
}

export function useIngestCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ingested: number }>("/ci-runs/ingest"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ci-runs"] }),
  });
}
