/* hooks/eval.ts — React Query hooks for the L06 Eval Pipeline (agent eval
   cases, batch runs, batch history/detail, trend, and compare). Mirrors the
   pattern established in hooks/agents.ts. */
"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCaseListItem,
  EvalCaseCreateInput,
  EvalBatch,
  EvalBatchDetail,
  EvalTrendPointV2,
  EvalRunBatchRequest,
  EvalBatchCompareResult,
  EvalCaseListResponse,
  EvalRunAcceptedResponse,
  EvalKpiDeltaResponse,
  EvalAgentSummary,
  EvalRecentBatchRow,
  EvalRunAllResult,
} from "@devdigest/shared";

export type { EvalCaseListResponse };

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: ({ signal }) => api.get<EvalCaseListResponse>(`/agents/${agentId}/evals/cases`, { signal }),
    enabled: !!agentId,
  });
}

export function useCreateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseCreateInput) =>
      api.post<EvalCaseListItem>(`/agents/${agentId}/evals/cases`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
  });
}

export interface UpdateEvalCaseInput {
  caseId: string;
  input: EvalCaseCreateInput;
}

export function useUpdateEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, input }: UpdateEvalCaseInput) =>
      api.patch<EvalCaseListItem>(`/agents/${agentId}/evals/cases/${caseId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
  });
}

export interface CreateEvalCaseFromFindingInput {
  findingId: string;
  agentId?: string | null;
}

export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId }: CreateEvalCaseFromFindingInput) =>
      api.post<EvalCaseListItem>(`/findings/${findingId}/evals/case`),
    onSuccess: (_data, { agentId }) => {
      if (agentId) {
        qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      } else {
        qc.invalidateQueries({ queryKey: ["eval-cases"] });
      }
    },
  });
}

export function useDeleteEvalCase(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/agents/${agentId}/evals/cases/${caseId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases", agentId] }),
  });
}

/**
 * `POST /agents/:id/evals/run` — 202 Accepted; the server enqueues the batch
 * and returns only `{ batch_id }` (`EvalRunAcceptedResponse`). The full-fan-out
 * LLM run can take minutes, so this mutation does NOT await completion — the
 * caller must poll `useEvalBatchDetail(agentId, batch_id)` (self-polls while
 * `status` is null, see below) to know when the batch actually finishes.
 * We still invalidate the case list + batch history right away so the new
 * (in-flight) batch row appears immediately with a neutral/running status.
 */
export function useRunEvalBatch(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EvalRunBatchRequest) =>
      api.post<EvalRunAcceptedResponse>(`/agents/${agentId}/evals/run`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-batches", agentId] });
    },
  });
}

export function useEvalBatchHistory(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-batches", agentId],
    queryFn: ({ signal }) => api.get<EvalBatch[]>(`/agents/${agentId}/evals/batches`, { signal }),
    enabled: !!agentId,
  });
}

/**
 * KPI delta (AC-31) vs. the previous FULL batch. The server route
 * (`GET /agents/:id/evals/kpi-delta?batch_id=`) computes the delta relative
 * to a specific "latest" batch id, so this hook first resolves the most
 * recent FULL batch from the already-fetched history (`useEvalBatchHistory`
 * — `listBatchHistory` is ordered `ran_at DESC`, per `server/src/modules/eval
 * /repository.ts`) and only queries kpi-delta once that id is known.
 * Returns `null` (not an error) when there is no previous full batch to
 * compare against — the caller renders a muted empty state for that case.
 */
export function useEvalKpiDelta(agentId: string | null | undefined) {
  const { data: batches } = useEvalBatchHistory(agentId);
  const latestFullBatchId = batches?.find((b) => b.kind === "full")?.id ?? null;

  return useQuery({
    queryKey: ["eval-kpi-delta", agentId, latestFullBatchId],
    queryFn: ({ signal }) =>
      api.get<EvalKpiDeltaResponse>(
        `/agents/${agentId}/evals/kpi-delta?batch_id=${latestFullBatchId}`,
        { signal },
      ),
    enabled: !!agentId && !!latestFullBatchId,
  });
}

/**
 * Batch drill-down — also doubles as the completion poll for a just-fired
 * run (#9): while the batch row's `status` is still null (in flight), this
 * query self-polls every 3s (precedent: `usePrRuns`/`usePrActiveRuns` in
 * `hooks/reviews.ts`). Once `status` flips to `clean`/`degraded`, polling
 * stops on its own. See `useEvalRunCompletion` below, which wraps this query
 * and invalidates the dependent queries when that transition happens.
 */
export function useEvalBatchDetail(agentId: string | null | undefined, batchId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-batch-detail", agentId, batchId],
    queryFn: ({ signal }) =>
      api.get<EvalBatchDetail>(`/agents/${agentId}/evals/batches/${batchId}`, { signal }),
    enabled: !!batchId,
    refetchInterval: (query) => (query.state.data?.status == null ? 3000 : false),
  });
}

/**
 * #9 — completion watcher for a just-fired run. Wraps `useEvalBatchDetail`'s
 * self-polling query and fires the queries that must refresh once the batch
 * actually finishes (`status` leaves null): the case list (per-case
 * last_run_status/summary) always, and the trend chart only for `kind ===
 * "full"` (calibration batches are excluded from trend, so invalidating it
 * for a calibration run would be a wasted refetch). Keeps `EvalsTab` free of
 * a direct `useQueryClient()` call so its own test only needs to mock this
 * module, not `@tanstack/react-query` itself.
 */
export function useEvalRunCompletion(agentId: string, batchId: string | null) {
  const qc = useQueryClient();
  const detail = useEvalBatchDetail(agentId, batchId);

  React.useEffect(() => {
    if (!batchId) return;
    if (detail.data && detail.data.status != null) {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-batches", agentId] });
      if (detail.data.kind === "full") {
        qc.invalidateQueries({ queryKey: ["eval-trend", agentId] });
        qc.invalidateQueries({ queryKey: ["eval-kpi-delta", agentId] });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, detail.data, agentId]);

  return detail;
}

/**
 * "Clear history" (destructive) — `DELETE /agents/:id/evals/batches` wipes all
 * eval batches (and their per-case runs) for this agent; eval CASES themselves
 * are untouched. Response body is `{ deleted_batches, deleted_runs }` but the
 * caller only needs the success signal, so it's loosely typed here. On
 * success, invalidate every query the batch history feeds: batch history and
 * trend chart both render off `eval_batches` directly; KPI delta is derived
 * from batch history; and per-case `last_run_status`/`last_run_summary` must
 * reset back to their pre-run state once the runs are gone.
 */
export function useClearEvalHistory(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.del<{ deleted_batches: number; deleted_runs: number }>(`/agents/${agentId}/evals/batches`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-batches", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-trend", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-kpi-delta", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
    },
  });
}

export function useEvalTrend(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-trend", agentId],
    queryFn: ({ signal }) => api.get<EvalTrendPointV2[]>(`/agents/${agentId}/evals/trend`, { signal }),
    enabled: !!agentId,
  });
}

export function useEvalCompare(
  agentId: string | null | undefined,
  batchIdA: string | null | undefined,
  batchIdB: string | null | undefined
) {
  return useQuery({
    queryKey: ["eval-compare", agentId, batchIdA, batchIdB],
    queryFn: ({ signal }) =>
      api.get<EvalBatchCompareResult>(
        `/agents/${agentId}/evals/compare?a=${batchIdA}&b=${batchIdB}`,
        { signal }
      ),
    enabled: !!batchIdA && !!batchIdB,
  });
}

// ===========================================================================
// Cross-Agent Eval Dashboard — overview grid, recent-batches feed, run-all
// ===========================================================================

/** Dashboard agent grid — one row per agent (latest batch + recall sparkline). */
export function useEvalOverview() {
  return useQuery({
    queryKey: ["eval-overview"],
    queryFn: ({ signal }) => api.get<EvalAgentSummary[]>("/evals/overview", { signal }),
  });
}

/** Dashboard "recent batches" feed, across all agents. */
export function useEvalRecentAcrossAgents() {
  return useQuery({
    queryKey: ["eval-recent"],
    queryFn: ({ signal }) => api.get<EvalRecentBatchRow[]>("/evals/recent", { signal }),
  });
}

/**
 * "Run all" (dashboard) — fires a full batch for every enabled agent at once.
 * On success, invalidate both dashboard queries so the grid and recent feed
 * pick up the newly-started (in-flight) batches right away.
 */
export function useRunAllAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunAllResult>("/evals/run-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-overview"] });
      qc.invalidateQueries({ queryKey: ["eval-recent"] });
    },
  });
}
