/* hooks/skills.ts — React Query hooks for the Skills Lab (A1). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Skill,
  SkillType,
  SkillSource,
  SkillVersion,
  SkillStats,
  ImportPreview,
  AgentSkillLink,
  SkillEvalCaseListItem,
  SkillEvalCaseListResponse,
  SkillEvalCaseCreateInput,
  SkillEvalBatch,
  SkillEvalBatchDetail,
  SkillEvalRunBatchRequest,
  SkillEvalRunAcceptedResponse,
  SkillEvalTrendPoint,
  SkillEvalBatchCompareResult,
  SkillEvalKpiDeltaResponse,
  SkillEvalClearHistoryResponse,
} from "@devdigest/shared";

// ---- Skills CRUD -----------------------------------------------------------

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: ({ signal }) => api.get<Skill[]>("/skills", { signal }),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: ({ signal }) => api.get<Skill>(`/skills/${id}`, { signal }),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  source?: SkillSource;
  body: string;
  enabled?: boolean;
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: {
    name?: string;
    description?: string;
    type?: SkillType;
    body?: string;
    enabled?: boolean;
  };
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.patch<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

// ---- Versions --------------------------------------------------------------

export function useSkillVersions(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-versions", skillId],
    queryFn: ({ signal }) => api.get<SkillVersion[]>(`/skills/${skillId}/versions`, { signal }),
    enabled: !!skillId,
  });
}

export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, version }: { skillId: string; version: number }) =>
      api.post<Skill>(`/skills/${skillId}/versions/${version}/restore`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      qc.invalidateQueries({ queryKey: ["skill-versions", data.id] });
    },
  });
}

// ---- Stats -----------------------------------------------------------------

export function useSkillStats(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-stats", skillId],
    queryFn: ({ signal }) => api.get<SkillStats>(`/skills/${skillId}/stats`, { signal }),
    enabled: !!skillId,
    staleTime: 60_000,
  });
}

// ---- Import ----------------------------------------------------------------

export function useImportPreview() {
  return useMutation({
    mutationFn: (input: { name: string; filename: string; content_base64: string }) =>
      api.post<ImportPreview>("/skills/import", input),
  });
}

export function useConfirmImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      description: string;
      type: SkillType;
      body: string;
      source: SkillSource;
      enabled?: boolean;
    }) => api.post<Skill>("/skills/import/confirm", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

// ---- Eval cases (existing eval_cases table, owner_kind='skill') ------------
//
// `GET /skills/:id/evals` now returns `{ cases: SkillEvalCaseListItem[] }`
// (flat `last_run_status`/`last_run_summary`/`last_host_agent_id` fields) —
// RESHAPED from the old bare-array response with a nested `last_run` object.
// `useSkillEvals` is kept as the query fn's name (single existing call site,
// `SkillDetail/EvalsTab.tsx`, is rewritten in a parallel sibling step) but its
// return shape is now `SkillEvalCaseListItem[]` from `@devdigest/shared` —
// the local `SkillEvalCase` type alias is removed, never redefine this shape
// locally.

export function useSkillEvals(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-evals", skillId],
    queryFn: ({ signal }) =>
      api
        .get<SkillEvalCaseListResponse>(`/skills/${skillId}/evals`, { signal })
        .then((r) => r.cases),
    enabled: !!skillId,
  });
}

/**
 * Create a hand-authored skill eval case. `POST /skills/:id/evals` is wired to
 * `SkillEvalService.createCaseManual`, which enforces AC-2 (practices OR
 * grounding non-empty) / AC-3 (non-empty fixture) server-side and defaults
 * `input_meta.source:'manual'`. The body is the shared
 * `SkillEvalCaseCreateInput` posted directly (no wire-shape translation); the
 * skill id from the route is injected so it always matches the path param.
 */
export function useCreateSkillEval(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillEvalCaseCreateInput) =>
      api.post<SkillEvalCaseListItem>(`/skills/${skillId}/evals`, { ...input, skill_id: skillId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skill-evals", skillId] }),
  });
}

export function useDeleteSkillEval(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/skills/${skillId}/evals/${caseId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skill-evals", skillId] }),
  });
}

/** Edit-in-place (full replacement; AC-39's threshold edit applies too). */
export interface UpdateSkillEvalCaseInput {
  caseId: string;
  input: SkillEvalCaseCreateInput;
}

export function useUpdateSkillEvalCase(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, input }: UpdateSkillEvalCaseInput) =>
      api.patch<SkillEvalCaseListItem>(`/skills/${skillId}/evals/${caseId}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skill-evals", skillId] }),
  });
}

/**
 * Promote an already-accepted/dismissed finding into a SKILL-eval case
 * (AC-4) — the target skill is an explicit author choice (`skill_id` in the
 * mutation variables), never inferred from route params, since this hook is
 * called from a FindingCard context that doesn't inherently know which skill
 * tab is open.
 */
export interface CreateSkillEvalCaseFromFindingInput {
  findingId: string;
  skill_id: string;
}

export function useCreateSkillEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ findingId, skill_id }: CreateSkillEvalCaseFromFindingInput) =>
      api.post<SkillEvalCaseListItem>(`/findings/${findingId}/evals/skill-case`, { skill_id }),
    onSuccess: (_data, { skill_id }) => {
      qc.invalidateQueries({ queryKey: ["skill-evals", skill_id] });
    },
  });
}

/**
 * `POST /skills/:id/evals/run` — 202 Accepted; the server enqueues the batch
 * and returns only `{ batch_id }`. `host_agent_id` is always included;
 * omitting `case_ids` runs the full case set, providing a strict subset
 * records a `calibration` batch. The caller must poll
 * `useSkillEvalBatchDetail(skillId, batch_id)` (self-polls while `status` is
 * null) to know when the batch actually finishes — mirrors
 * `useRunEvalBatch`/`useEvalRunCompletion` in `hooks/eval.ts`.
 */
export function useRunSkillEvalBatch(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SkillEvalRunBatchRequest) =>
      api.post<SkillEvalRunAcceptedResponse>(`/skills/${skillId}/evals/run`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-evals", skillId] });
      qc.invalidateQueries({ queryKey: ["skill-eval-batches", skillId] });
    },
  });
}

export function useSkillEvalBatchHistory(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-batches", skillId],
    queryFn: ({ signal }) => api.get<SkillEvalBatch[]>(`/skills/${skillId}/evals/batches`, { signal }),
    enabled: !!skillId,
  });
}

/**
 * Batch drill-down — also doubles as the completion poll for a just-fired
 * run: while the batch row's `status` is still null (in flight), this query
 * self-polls. Reuses the SAME `refetchInterval` value as `hooks/eval.ts`'s
 * `useEvalBatchDetail` (3000ms) for consistency across the two eval
 * pipelines.
 */
export function useSkillEvalBatchDetail(
  skillId: string | null | undefined,
  batchId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["skill-eval-batch-detail", skillId, batchId],
    queryFn: ({ signal }) =>
      api.get<SkillEvalBatchDetail>(`/skills/${skillId}/evals/batches/${batchId}`, { signal }),
    enabled: !!batchId,
    refetchInterval: (query) => (query.state.data?.status == null ? 3000 : false),
  });
}

/**
 * Trend chart data — one point per sealed 'full'-kind batch (mirrors
 * `useEvalTrend` in `hooks/eval.ts`). Reverses this feature's original spec
 * Non-goal (TrendChart) at the user's explicit request — see
 * docs/plans/2026-07-06-skill-eval-handoff.md.
 */
export function useSkillEvalTrend(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-eval-trend", skillId],
    queryFn: ({ signal }) => api.get<SkillEvalTrendPoint[]>(`/skills/${skillId}/evals/trend`, { signal }),
    enabled: !!skillId,
  });
}

/** Side-by-side comparison of two full-kind batches (mirrors `useEvalCompare`). */
export function useSkillEvalCompare(
  skillId: string | null | undefined,
  batchIdA: string | null | undefined,
  batchIdB: string | null | undefined,
) {
  return useQuery({
    queryKey: ["skill-eval-compare", skillId, batchIdA, batchIdB],
    queryFn: ({ signal }) =>
      api.get<SkillEvalBatchCompareResult>(
        `/skills/${skillId}/evals/compare?a=${batchIdA}&b=${batchIdB}`,
        { signal },
      ),
    enabled: !!batchIdA && !!batchIdB,
  });
}

/**
 * KPI delta vs. the previous FULL batch (mirrors `useEvalKpiDelta`). Resolves
 * the most recent full-kind batch from `useSkillEvalBatchHistory`'s
 * already-fetched data (server-sorted `ran_at DESC`) and only queries
 * kpi-delta once that id is known. Returns `null` (not an error) when there
 * is no previous full batch to compare against.
 */
export function useSkillEvalKpiDelta(skillId: string | null | undefined) {
  const { data: batches } = useSkillEvalBatchHistory(skillId);
  const latestFullBatchId = batches?.find((b) => b.kind === "full")?.id ?? null;

  return useQuery({
    queryKey: ["skill-eval-kpi-delta", skillId, latestFullBatchId],
    queryFn: ({ signal }) =>
      api.get<SkillEvalKpiDeltaResponse>(
        `/skills/${skillId}/evals/kpi-delta?batch_id=${latestFullBatchId}`,
        { signal },
      ),
    enabled: !!skillId && !!latestFullBatchId,
  });
}

/**
 * "Clear history" (destructive) — `DELETE /skills/:id/evals/batches` wipes
 * all skill-eval batches (and their per-case runs) for this skill; eval CASES
 * themselves are untouched. Mirrors `useClearEvalHistory`. On success,
 * invalidate every query the batch history feeds: case list (per-case
 * `last_run_status`/`last_run_summary` reset), batch history, trend chart,
 * and KPI delta (derived from batch history).
 */
export function useClearSkillEvalHistory(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.del<SkillEvalClearHistoryResponse>(`/skills/${skillId}/evals/batches`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill-evals", skillId] });
      qc.invalidateQueries({ queryKey: ["skill-eval-batches", skillId] });
      qc.invalidateQueries({ queryKey: ["skill-eval-trend", skillId] });
      qc.invalidateQueries({ queryKey: ["skill-eval-kpi-delta", skillId] });
    },
  });
}

// ---- Agent ↔ Skills linking (used by Agent Editor SkillsTab) --------------

export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: ({ signal }) => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`, { signal }),
    enabled: !!agentId,
  });
}

export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillIds: string[]) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-skills", agentId] }),
  });
}

export function useLinkAgentSkill(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, order }: { skillId: string; order: number }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_id: skillId, order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-skills", agentId] }),
  });
}
