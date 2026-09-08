/* hooks/eval.ts — React Query hooks for the Eval pipeline
   (specs/12-eval-pipeline.md, plans/12-eval-pipeline.md §8).

   Q3 (background run + client polling, no SSE): `useEvalRun`'s
   `refetchInterval` returns a poll interval ONLY while `status === 'running'`
   — copied from `hooks/onboarding.ts` / `hooks/brief.ts`'s identical
   `status === 'generating'` shape. AC-28 (opening a surface spends nothing):
   every GET here reads stored rows; nothing on a read path starts a
   provider call. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalAgentDetail,
  EvalCaseInput,
  EvalCompare,
  EvalDashboard,
  EvalRunAllResult,
  EvalRunRecord,
  EvalRunResult,
  EvalSkillCarrier,
  EvalSkillCompare,
  EvalSkillOffer,
  EvalSkillRunEstimate,
  EvalSkillRunRecord,
} from "@devdigest/shared/contracts/eval-ci";
import type { EvalCase } from "@devdigest/shared/contracts/knowledge";

export const evalKeys = {
  cases: (ownerId: string | null | undefined) => ["eval-cases", ownerId] as const,
  case: (caseId: string | null | undefined) => ["eval-case", caseId] as const,
  runs: (ownerId: string | null | undefined) => ["eval-runs", ownerId] as const,
  run: (runId: string | null | undefined) => ["eval-run", runId] as const,
  dashboard: () => ["eval-dashboard"] as const,
  agentDetail: (agentId: string | null | undefined) => ["eval-agent-detail", agentId] as const,
  compare: (a: string | null | undefined, b: string | null | undefined) =>
    ["eval-compare", a, b] as const,
  // specs/15-skill-eval-cases.md §10 — skill-owned surfaces. `cases`/`case`/
  // `runs`/`run`/`dashboard` above are already keyed by OWNER id, not owner
  // kind (plan §10), so they're reused verbatim for a skill owner; only the
  // genuinely skill-specific reads/mutations below need their own keys.
  skillCarriers: (skillId: string | null | undefined) => ["eval-skill-carriers", skillId] as const,
  skillEstimate: (skillId: string | null | undefined, carrierId: string | null | undefined) =>
    ["eval-skill-estimate", skillId, carrierId] as const,
  skillCompare: (a: string | null | undefined, b: string | null | undefined) =>
    ["eval-skill-compare", a, b] as const,
  findingSkillOffers: (findingId: string | null | undefined) =>
    ["eval-finding-skill-offers", findingId] as const,
};

/**
 * specs/15-skill-eval-cases.md plan §6 — `POST /skills/:id/eval/runs`' and
 * `POST /eval/skills/runs/all`'s response shapes. Neither is a `vendor/shared`
 * zod contract (mirrors the server's own `EvalSkillRunAllResult`,
 * `server/src/modules/eval/service.ts` — TS-typed only, no route in that
 * module declares a zod `response` schema for anything it returns).
 */
export interface EvalSkillRunResult {
  run_id: string;
  status: "running";
  estimate: EvalSkillRunEstimate;
}

export interface EvalSkillRunAllResult {
  estimate: { skills_total: number; cases_total: number; executions_total: number };
  started: Array<{
    skill_id: string;
    skill_name: string;
    carrier_agent_id: string | null;
    carrier_agent_name: string | null;
    run_id: string | null;
    refused_reason: string | null;
  }>;
}

// ---- Cases (AC-37 … AC-39, AC-46) -----------------------------------------

/** GET /agents/:id/eval/cases — the Evals tab's case list. */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(agentId),
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval/cases`),
    enabled: !!agentId,
  });
}

/** GET /eval/cases/:id — one case's full frozen input + expectation (AC-39). */
export function useEvalCase(caseId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.case(caseId),
    queryFn: () => api.get<EvalCase>(`/eval/cases/${caseId}`),
    enabled: !!caseId,
  });
}

/** POST /agents/:id/eval/cases — the hand-authored path for an agent-owned
 *  case, the mirror of `useCreateSkillEvalCase` below (same body shape, same
 *  `evalKeys.cases` invalidation). */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: EvalCaseInput }) =>
      api.post<EvalCase>(`/agents/${agentId}/eval/cases`, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(data.owner_id) });
    },
  });
}

/**
 * POST /findings/:id/eval-case (AC-1 … AC-7). Returns `created: false` on the
 * D17 idempotent path (server responded 200, not 201) — the FindingCard toast
 * needs this to say "already exists" rather than "created", per §10.
 */
export function useCreateEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (findingId: string) => {
      const { data, status } = await api.postWithStatus<EvalCase>(`/findings/${findingId}/eval-case`);
      return { case: data, created: status === 201 };
    },
    onSuccess: ({ case: evalCase }) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(evalCase.owner_id) });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
      qc.invalidateQueries({ queryKey: evalKeys.agentDetail(evalCase.owner_id) });
    },
  });
}

/**
 * specs/15-skill-eval-cases.md AC-2 — GET /findings/:id/eval-skills' offer
 * list: only the skills the finding's own review actually injected (D10 —
 * "present, not causal"). Enabled only when a caller supplies a finding id,
 * so opening the panel doesn't fire one GET per finding on mount — the
 * caller (FindingsPanel) passes a finding id only once the user asks to see
 * the offer list for that finding.
 */
export function useFindingEvalSkills(findingId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.findingSkillOffers(findingId),
    queryFn: () => api.get<EvalSkillOffer[]>(`/findings/${findingId}/eval-skills`),
    enabled: !!findingId,
  });
}

/**
 * POST /findings/:id/skill-eval-case (AC-1 … AC-7, R3 — a separate route
 * from the agent path). Same 201/200 idempotency shape as
 * `useCreateEvalCaseFromFinding` (`api.postWithStatus`, `client/LEARNINGS.md`
 * 2026-08-19).
 */
export function useCreateSkillEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ findingId, skillId }: { findingId: string; skillId: string }) => {
      const { data, status } = await api.postWithStatus<EvalCase>(
        `/findings/${findingId}/skill-eval-case`,
        { skill_id: skillId },
      );
      return { case: data, created: status === 201 };
    },
    onSuccess: ({ case: evalCase }, { findingId }) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(evalCase.owner_id) });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
      qc.invalidateQueries({ queryKey: evalKeys.findingSkillOffers(findingId) });
    },
  });
}

/** PATCH /eval/cases/:id (AC-12, AC-13) — re-validated server-side; never
 *  touches stored runs (AC-14). */
export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<EvalCaseInput> }) =>
      api.patch<EvalCase>(`/eval/cases/${id}`, patch),
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: evalKeys.case(id) });
    },
    onSuccess: (data) => {
      qc.setQueryData(evalKeys.case(data.id), data);
      qc.invalidateQueries({ queryKey: evalKeys.cases(data.owner_id) });
    },
  });
}

/** DELETE /eval/cases/:id (AC-12, AC-14). `ownerId` is passed alongside the
 *  case id so the right cases list gets invalidated — the 204 response
 *  carries nothing to derive it from. */
export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; ownerId: string }) => api.del<void>(`/eval/cases/${id}`),
    onSuccess: (_data, { id, ownerId }) => {
      qc.removeQueries({ queryKey: evalKeys.case(id) });
      qc.invalidateQueries({ queryKey: evalKeys.cases(ownerId) });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
    },
  });
}

// ---- Runs (AC-8, AC-15, AC-24 … AC-28, AC-49) ------------------------------

/** GET /agents/:id/eval/runs — this agent's run history (RunHistory table). */
export function useEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.runs(agentId),
    queryFn: () => api.get<EvalRunRecord[]>(`/agents/${agentId}/eval/runs`),
    enabled: !!agentId,
  });
}

/** GET /eval/runs/:id — the poll target (Q3). Polls every 3s ONLY while
 *  `status === 'running'`, so a viewer who didn't start the run still sees it
 *  finish, and a settled run polls never. */
export function useEvalRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.run(runId),
    queryFn: () => api.get<EvalRunRecord>(`/eval/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 3000 : false),
  });
}

/** POST /agents/:id/eval/runs (AC-8, AC-15, AC-24, AC-49) — starts a
 *  background run and returns immediately with the run id + estimate; the
 *  caller polls `useEvalRun(run_id)` for completion. */
export function useStartEvalRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<EvalRunResult>(`/agents/${agentId}/eval/runs`),
    onSuccess: (_data, agentId) => {
      qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
      qc.invalidateQueries({ queryKey: evalKeys.agentDetail(agentId) });
    },
  });
}

/** POST /eval/runs/all (AC-25, AC-42) — `confirm: true` is a contract
 *  requirement (the route 422s without it), not a client convention; the
 *  confirmation dialog itself is what gates this call being made at all. */
export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunAllResult>(`/eval/runs/all`, { confirm: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
    },
  });
}

// ---- Skill-owned cases + runs (specs/15-skill-eval-cases.md §10) ----------

/** GET /skills/:id/eval/cases — the skill Evals tab's case list. Reuses
 *  `evalKeys.cases`, keyed by owner id only (plan §10), so an update/delete
 *  on a skill-owned case (via the owner-agnostic `useUpdateEvalCase`/
 *  `useDeleteEvalCase` above) invalidates this list too, unchanged. */
export function useSkillEvalCases(skillId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(skillId),
    queryFn: () => api.get<EvalCase[]>(`/skills/${skillId}/eval/cases`),
    enabled: !!skillId,
  });
}

/** POST /skills/:id/eval/cases (AC-8) — the hand-authored path; skills have
 *  no agent-side equivalent (a skill never had a finding to derive from
 *  before it was ever injected into a review). */
export function useCreateSkillEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, input }: { skillId: string; input: EvalCaseInput }) =>
      api.post<EvalCase>(`/skills/${skillId}/eval/cases`, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: evalKeys.cases(data.owner_id) });
    },
  });
}

/** GET /skills/:id/eval/carriers (AC-11) — the carrier picker's options,
 *  already `order asc, name asc` at the repository level (no client sort). */
export function useSkillEvalCarriers(skillId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.skillCarriers(skillId),
    queryFn: () => api.get<EvalSkillCarrier[]>(`/skills/${skillId}/eval/carriers`),
    enabled: !!skillId,
  });
}

/** GET /skills/:id/eval/estimate?carrier_agent_id= (AC-11, AC-25) — stated
 *  before any execution starts; `executions_total` is `2 × cases_total`. */
export function useSkillEvalEstimate(
  skillId: string | null | undefined,
  carrierAgentId: string | null | undefined,
) {
  return useQuery({
    queryKey: evalKeys.skillEstimate(skillId, carrierAgentId),
    queryFn: () =>
      api.get<EvalSkillRunEstimate>(
        `/skills/${skillId}/eval/estimate?carrier_agent_id=${carrierAgentId}`,
      ),
    enabled: !!skillId && !!carrierAgentId,
  });
}

/** GET /skills/:id/eval/runs — this skill's run history. */
export function useSkillEvalRuns(skillId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.runs(skillId),
    queryFn: () => api.get<EvalSkillRunRecord[]>(`/skills/${skillId}/eval/runs`),
    enabled: !!skillId,
  });
}

/** GET /eval/runs/:id, typed as the widened `EvalSkillRunRecord` (the route
 *  is owner-agnostic — `routes.ts` — and returns the wider shape whenever
 *  the row's `owner_kind` is `'skill'`). Same poll-only-while-running shape
 *  as `useEvalRun` (AC-29 — a read surface never triggers work), and the
 *  same query key: both hooks read the identical resource. */
export function useSkillEvalRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.run(runId),
    queryFn: () => api.get<EvalSkillRunRecord>(`/eval/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 3000 : false),
  });
}

/** POST /skills/:id/eval/runs (AC-11, AC-12, AC-15, AC-25, AC-49) — starts a
 *  background two-armed run against the chosen carrier; the caller polls
 *  `useSkillEvalRun(run_id)` for completion. */
export function useStartSkillEvalRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, carrierAgentId }: { skillId: string; carrierAgentId: string }) =>
      api.post<EvalSkillRunResult>(`/skills/${skillId}/eval/runs`, {
        carrier_agent_id: carrierAgentId,
      }),
    onSuccess: (_data, { skillId }) => {
      qc.invalidateQueries({ queryKey: evalKeys.runs(skillId) });
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
    },
  });
}

/** POST /eval/skills/runs/all (AC-26, R5) — `confirm: true` is a contract
 *  requirement; carriers are auto-selected server-side and the dialog that
 *  triggers this states so. */
export function useRunAllSkillEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalSkillRunAllResult>(`/eval/skills/runs/all`, { confirm: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
    },
  });
}

/** GET /eval/skills/compare?a=&b= (AC-32, AC-33) — two skill-owned runs of
 *  the same skill. */
export function useSkillEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.skillCompare(a, b),
    queryFn: () => api.get<EvalSkillCompare>(`/eval/skills/compare?a=${a}&b=${b}`),
    enabled: !!a && !!b && a !== b,
  });
}

// ---- Dashboard + agent detail + compare (AC-32 … AC-34, AC-40 … AC-48) ----

/** GET /eval/dashboard — workspace-level, NOT repo-scoped (AC-40). */
export function useEvalDashboard() {
  return useQuery({
    queryKey: evalKeys.dashboard(),
    queryFn: () => api.get<EvalDashboard>("/eval/dashboard"),
  });
}

/** GET /eval/agents/:id (AC-44, AC-45, AC-48). */
export function useEvalAgentDetail(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.agentDetail(agentId),
    queryFn: () => api.get<EvalAgentDetail>(`/eval/agents/${agentId}`),
    enabled: !!agentId,
  });
}

/** GET /eval/compare?a=&b= (AC-32 … AC-34) — exactly two distinct run ids. */
export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(a, b),
    queryFn: () => api.get<EvalCompare>(`/eval/compare?a=${a}&b=${b}`),
    enabled: !!a && !!b && a !== b,
  });
}
