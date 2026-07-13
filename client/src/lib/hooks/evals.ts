/* hooks/evals.ts — React Query mutations/queries for the eval-pipeline (T8+).
   T9 added useEvalCases / useRunAgentEvals / useDeleteEvalCase.
   T10 will add useEvalDashboard / useCompareRuns / usePromoteVersion here.

   All keys come from `qk` — no inline literal arrays (INSIGHTS 2026-06-29). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { qk } from "../query-keys";
import { notify } from "../providers/toast";
import type { Finding, FindingActionKind } from "@devdigest/shared";
import type { EvalCase, EvalRunGroupResult, EvalRunGroup, EvalDashboard, AgentVersion, EvalCompareResult } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// One-click shape for POST /agents/:id/eval-cases (AC-4, T5 backend).
//
// The backend discriminates on `'action' in body`:
//   • action = 'accept'  → must_find case  (AC-1)
//   • action = 'dismiss' → must_not_flag case (AC-2)
//
// Do NOT include owner_kind / owner_id — the route derives them from :id.
// ---------------------------------------------------------------------------

export interface CreateEvalCaseOneClickInput {
  agentId: string;
  /** The finding (accepted or dismissed) to turn into an eval case. */
  finding: Finding;
  /** Derived from the finding's accepted/dismissed state by the caller. */
  action: Extract<FindingActionKind, "accept" | "dismiss">;
  /** PR id (UUID) — threaded so the server can load the stored diff (A gap fix, AC-6). */
  pull_request_id?: string;
  /** Optional frozen diff fragment to store as input_diff (AC-6). */
  input_diff?: string;
  /** Optional human name; backend defaults to the finding title. */
  name?: string;
}

/**
 * One-click "Turn into eval case" mutation (AC-4).
 *
 * POSTs the one-click shape to `POST /agents/:id/eval-cases`.
 * On success: shows a success toast and invalidates the agent's eval-cases list
 * so T9's EvalsTab re-fetches without a page reload.
 * On error: shows an error toast.
 */
export function useCreateEvalCase() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, finding, action, pull_request_id, input_diff, name }: CreateEvalCaseOneClickInput) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases`, {
        action,
        finding,
        ...(pull_request_id !== undefined ? { pull_request_id } : {}),
        ...(input_diff !== undefined ? { input_diff } : {}),
        ...(name !== undefined ? { name } : {}),
      }),
    onSuccess: (_data, { agentId }) => {
      notify.success("Eval case created");
      // Invalidate so the EvalsTab (T9) refreshes without a page reload.
      void qc.invalidateQueries({ queryKey: qk.evalCases(agentId) });
    },
    onError: () => {
      notify.error("Failed to create eval case");
    },
  });
}

// ---------------------------------------------------------------------------
// Manual "New eval case" modal hook (CLIENT-001/002 — typed api.post, error surfaced)
// ---------------------------------------------------------------------------

/** Input shape for the manual "New eval case" modal path (full EvalCaseInput). */
export interface CreateEvalCaseManualInput {
  agentId: string;
  owner_kind: 'agent' | 'skill';
  owner_id: string;
  name: string;
  input_diff?: string;
  input_meta?: unknown;
  expected_output: unknown;
}

/**
 * Manual "New eval case" mutation used by the EvalsTab NewCaseModal (T9).
 *
 * Replaces the raw `fetch` call (CLIENT-001): uses the typed `api.post` wrapper
 * and surfaces failures via the `notify` utility (CLIENT-002) so the user sees
 * an error toast on failure rather than a silently swallowed catch.
 *
 * On success: invalidates `qk.evalCases(agentId)` so the list refreshes.
 */
export function useCreateEvalCaseManual() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, ...body }: CreateEvalCaseManualInput) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases`, body),
    onSuccess: (_data, { agentId }) => {
      notify.success("Eval case created");
      void qc.invalidateQueries({ queryKey: qk.evalCases(agentId) });
    },
    onError: () => {
      notify.error("Failed to create eval case");
    },
  });
}

// ---------------------------------------------------------------------------
// T9 — AgentEditor Evals tab hooks
// ---------------------------------------------------------------------------

/**
 * Fetches the list of eval cases for one agent.
 * Uses `qk.evalCases(agentId)` — invalidated by `useCreateEvalCase` on success.
 */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery<EvalCase[]>({
    queryKey: qk.evalCases(agentId),
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId!}/eval-cases`),
    enabled: !!agentId,
  });
}

/**
 * Deletes one eval case for an agent.
 * On success: invalidates `qk.evalCases(agentId)` so the list re-fetches.
 */
export function useDeleteEvalCase() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, caseId }: { agentId: string; caseId: string }) =>
      api.del<void>(`/agents/${agentId}/eval-cases/${caseId}`),
    onSuccess: (_data, { agentId }) => {
      notify.success("Eval case deleted");
      void qc.invalidateQueries({ queryKey: qk.evalCases(agentId) });
    },
    onError: () => {
      notify.error("Failed to delete eval case");
    },
  });
}

/**
 * Runs all eval cases for an agent (`POST /agents/:id/eval-runs`).
 * Returns `EvalRunGroupResult` (the group aggregate + per-case results).
 * On success: invalidates `qk.evalRunGroups(agentId)` so run history updates.
 */
export function useRunAgentEvals() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, label }: { agentId: string; label?: string }) =>
      api.post<EvalRunGroupResult>(`/agents/${agentId}/eval-runs`, label ? { label } : undefined),
    onSuccess: (_data, { agentId }) => {
      notify.success("Eval run complete");
      void qc.invalidateQueries({ queryKey: qk.evalRunGroups(agentId) });
      // Also refresh the cases list (latest run results may update pass/fail display).
      void qc.invalidateQueries({ queryKey: qk.evalCases(agentId) });
    },
    onError: () => {
      notify.error("Failed to run evals");
    },
  });
}

// ---------------------------------------------------------------------------
// T10 hooks — Eval Dashboard + Compare modal + Promote
// ---------------------------------------------------------------------------

/**
 * Fetches the cross-agent Eval Dashboard aggregate (AC-20).
 * `GET /evals/dashboard` → `EvalDashboard[]` (all agents' metrics + recent runs).
 */
export function useEvalDashboard() {
  return useQuery<EvalDashboard[]>({
    queryKey: qk.evalDashboard(),
    queryFn: () => api.get<EvalDashboard[]>("/evals/dashboard"),
  });
}

/**
 * Runs ALL enabled agents over their own frozen case sets (AC-20).
 * `POST /eval-runs/all` → `EvalRunGroupResult[]`.
 * On success: invalidates `qk.evalDashboard()` so the dashboard re-fetches.
 */
export function useRunAllAgents() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<EvalRunGroupResult[]>("/eval-runs/all"),
    onSuccess: () => {
      notify.success("All agents run complete");
      void qc.invalidateQueries({ queryKey: qk.evalDashboard() });
    },
    onError: () => {
      notify.error("Failed to run all agents");
    },
  });
}

/**
 * Fetches run history for a single agent (`GET /agents/:id/eval-runs`).
 * Returns `EvalDashboard` (trend + recent_runs + aggregates, AC-15).
 * Key: `qk.evalRunGroups(agentId)` — shared with T9's invalidation target.
 */
export function useRunHistory(agentId: string | null | undefined) {
  return useQuery<EvalDashboard>({
    queryKey: qk.evalRunGroups(agentId),
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId!}/eval-runs`),
    enabled: !!agentId,
  });
}

/**
 * Lists an agent's run groups newest-first as `EvalRunGroup[]` (AC-16).
 * `GET /agents/:id/eval-run-groups`. Backs the Compare selector with REAL group
 * ids + recorded versions, so a selected run resolves to an existing group
 * (replaces client-side stub reconstruction from trend points).
 */
export function useEvalRunGroups(agentId: string | null | undefined) {
  return useQuery<EvalRunGroup[]>({
    queryKey: qk.evalRunGroupList(agentId),
    queryFn: () => api.get<EvalRunGroup[]>(`/agents/${agentId!}/eval-run-groups`),
    enabled: !!agentId,
  });
}

/**
 * Compares two run groups for an agent (AC-16).
 * `POST /agents/:id/eval-compare` with `{ run_group_id_a, run_group_id_b }`.
 * Returns `EvalCompareResult` (per-metric deltas + system_prompt diff).
 * The hook is query-based (stale-while-revalidate) keyed on both group ids.
 */
export function useCompareRuns(
  agentId: string | null | undefined,
  runGroupIdA: string | null | undefined,
  runGroupIdB: string | null | undefined,
) {
  return useQuery<EvalCompareResult>({
    queryKey: qk.evalCompare(agentId, runGroupIdA, runGroupIdB),
    queryFn: () =>
      api.post<EvalCompareResult>(`/agents/${agentId!}/eval-compare`, {
        run_group_id_a: runGroupIdA!,
        run_group_id_b: runGroupIdB!,
      }),
    enabled: !!agentId && !!runGroupIdA && !!runGroupIdB,
  });
}

/**
 * Promotes an agent to a specific recorded version (AC-18).
 * `POST /agents/:id/promote/:version` → `AgentVersion`.
 * On success: invalidates the agent's run groups and the dashboard.
 */
export function usePromoteVersion() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, version }: { agentId: string; version: number }) =>
      api.post<AgentVersion>(`/agents/${agentId}/promote/${version}`),
    onSuccess: (_data, { agentId }) => {
      notify.success("Version promoted");
      void qc.invalidateQueries({ queryKey: qk.evalRunGroups(agentId) });
      void qc.invalidateQueries({ queryKey: qk.evalDashboard() });
    },
    onError: () => {
      notify.error("Failed to promote version");
    },
  });
}
