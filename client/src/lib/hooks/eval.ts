/* hooks/eval.ts — React Query hooks for the A4 eval pipeline (§12).
   Eval cases CRUD, run a case, run-all for an agent, and the dashboard. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { EvalCase, EvalRun } from "@devdigest/shared";
import type {
  EvalCaseInput,
  EvalDashboard,
  EvalRunResult,
} from "@devdigest/shared/contracts/eval-ci";

type EvalCaseWithLast = EvalCase & {
  last_run?: {
    pass: boolean | null;
    recall: number | null;
    precision: number | null;
    ran_at: string;
  } | null;
};

export interface EvalCaseFilter {
  ownerKind?: "agent" | "skill";
  ownerId?: string;
}

function qs(filter?: EvalCaseFilter): string {
  if (!filter) return "";
  const sp = new URLSearchParams();
  if (filter.ownerKind) sp.set("owner_kind", filter.ownerKind);
  if (filter.ownerId) sp.set("owner_id", filter.ownerId);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function useEvalCases(filter?: EvalCaseFilter) {
  return useQuery({
    queryKey: ["eval-cases", filter ?? null],
    queryFn: () => api.get<EvalCaseWithLast[]>(`/eval-cases${qs(filter)}`),
  });
}

export function useEvalCase(id: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", id],
    queryFn: () => api.get<EvalCase>(`/eval-cases/${id}`),
    enabled: !!id,
  });
}

export function useEvalDashboard(filter?: EvalCaseFilter) {
  return useQuery({
    queryKey: ["eval-dashboard", filter ?? null],
    queryFn: () => api.get<EvalDashboard>(`/eval/dashboard${qs(filter)}`),
  });
}

export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) => api.post<EvalCase>("/eval-cases", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases"] }),
  });
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EvalCaseInput> }) =>
      api.put<EvalCase>(`/eval-cases/${id}`, patch),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.invalidateQueries({ queryKey: ["eval-case", id] });
    },
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/eval-cases/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases"] }),
  });
}

export function useRunEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<EvalRunResult>(`/eval-cases/${id}/run`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
    },
  });
}

export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<EvalRun>(`/agents/${agentId}/eval/run-all`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
    },
  });
}
