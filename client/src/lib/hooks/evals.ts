/* hooks/evals.ts — React Query hooks for SPEC-03 the Eval Pipeline (T8, wave 1).
   One hook per row of docs/plans/09-eval-pipeline.md §4.2's HTTP surface table;
   query keys are namespaced ["evals", …] (the reviews-module eval-draft query
   is the one exception — see below). The routes themselves are implemented by
   sibling server tasks in this same wave: the shapes here ARE the contract
   both sides code against, so a later client task never has to design a route
   again — only call the hook.

   Follows `client/INSIGHTS.md` 2026-08-27: every write below goes through
   `useMutation` so cache invalidation is never hand-rolled and skipped. */
"use client";

import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalBatchComparison,
  EvalBatchDetail,
  EvalBatchRecord,
  EvalCaseDraft,
  EvalCaseRecord,
  EvalCaseRunResult,
  EvalCaseWrite,
  EvalOwnerDashboard,
  EvalOwnerKind,
} from "@devdigest/shared";

// ---- Eval cases (REQ-7, 8, 9, 40, 51 · REQ-10, 43, 55-59 · REQ-12, 70 · REQ-11, 50) ----

/** One row of `GET /evals/cases` — the case plus its latest persisted run, if
    any (AC-8/AC-9 need both to render the pass/fail/never-run marker). Not a
    contract type of its own: it is `EvalCaseRecord` widened with the one field
    the list endpoint adds, composed locally rather than redeclaring the case
    shape itself. */
export interface EvalCaseListItem extends EvalCaseRecord {
  latest_run: EvalCaseRunResult | null;
}

/** `GET /evals/cases?owner_kind&owner_id` — an owner's cases + each one's
    latest run (AC-7's ordering is the server's job; this just serves it). */
export function useEvalCases(
  ownerKind: EvalOwnerKind | null | undefined,
  ownerId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["evals", "cases", ownerKind, ownerId],
    queryFn: () =>
      api.get<EvalCaseListItem[]>(
        `/evals/cases?owner_kind=${encodeURIComponent(ownerKind!)}&owner_id=${encodeURIComponent(ownerId!)}`,
      ),
    enabled: !!ownerKind && !!ownerId,
  });
}

/** `POST /evals/cases` — create (AC-10, AC-43, AC-55-59). `expectation_kind`
    is server-derived (AC-43); never sent here. */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseWrite) => api.post<EvalCaseRecord>("/evals/cases", input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["evals", "cases", data.owner_kind, data.owner_id] });
    },
  });
}

export interface UpdateEvalCaseInput {
  id: string;
  patch: EvalCaseWrite;
}

/** `PUT /evals/cases/:id` — update, same server-side derivations as create. */
export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateEvalCaseInput) =>
      api.put<EvalCaseRecord>(`/evals/cases/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["evals", "cases", data.owner_kind, data.owner_id] });
    },
  });
}

/** `DELETE /evals/cases/:id` — delete a case + its runs (AC-12, REQ-70). Takes
    the owner as hook args (mirrors `useDeleteRun(prId)`) since a delete
    response carries no owner to invalidate by. */
export function useDeleteEvalCase(
  ownerKind: EvalOwnerKind | null | undefined,
  ownerId: string | null | undefined,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/evals/cases/${caseId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["evals", "cases", ownerKind, ownerId] });
    },
  });
}

/** `POST /evals/cases/:id/run` — single-case run, WITH arm only (REQ-11, 50).
    Mirrors `useDeleteEvalCase`'s owner-as-hook-args shape.

    **`runningIds`, not `isPending`, is what a LIST must render from.** Several
    single-case runs may be in flight at once (they are independent HTTP
    requests — unlike a BATCH, which the server deliberately keeps strictly
    sequential), and one `useMutation` observer only ever tracks the LATEST
    call: calling `mutate` again re-points `isPending`/`variables` at the new
    mutation and detaches the observer from the first, so a caller deriving a
    per-row spinner from `variables` would move that spinner onto the row
    clicked second while the first is still running. `useMutationState` reads
    the mutation CACHE instead, so every in-flight run for this owner is
    visible. Mutation-level `onSuccess` (below) still fires for a detached
    mutation — only per-call `mutate(vars, { onSuccess })` callbacks are lost —
    so each concurrent run still invalidates the list when it lands. */
export function useRunEvalCase(
  ownerKind: EvalOwnerKind | null | undefined,
  ownerId: string | null | undefined,
) {
  const qc = useQueryClient();
  const mutationKey = ["evals", "run-case", ownerKind, ownerId];
  const mutation = useMutation({
    mutationKey,
    mutationFn: (caseId: string) => api.post<EvalCaseRunResult>(`/evals/cases/${caseId}/run`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["evals", "cases", ownerKind, ownerId] });
      // A single-case run now persists its own batch of 1 (owner decision,
      // 2026-08-29), so it lands in `recent_batches` and moves the headline
      // metrics exactly like a set run — the same two invalidations
      // `useStartEvalBatch` makes. Invalidating only the case list, as this
      // did while single runs wrote no batch row, would leave the dashboard
      // stale until an unrelated refetch.
      qc.invalidateQueries({ queryKey: ["evals", "batches", ownerKind, ownerId] });
      qc.invalidateQueries({ queryKey: ["evals", "dashboard"] });
    },
  });
  const runningIds = useMutationState({
    filters: { mutationKey, status: "pending", exact: true },
    select: (m) => m.state.variables as string,
  });
  return { ...mutation, runningIds };
}

// ---- Batches — start, detail, history, comparison (REQ-13-19, 31, 34-36, 68, 71) ----

export interface StartEvalBatchInput {
  owner_kind: EvalOwnerKind;
  owner_id: string;
}

export interface StartEvalBatchResponse {
  batch_id: string;
}

/** `POST /evals/batches` — start a set-run; the server answers `202` with the
    new batch's id (REQ-13, 14, 15, 68) — the caller polls `useEvalBatch` with
    it. Invalidates both this owner's batch history and the dashboard (the
    partial-match default of `invalidateQueries` covers the ["evals",
    "dashboard", ownerId] drill-in too — no separate call needed). */
export function useStartEvalBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartEvalBatchInput) =>
      api.post<StartEvalBatchResponse>("/evals/batches", input),
    onSuccess: (_data, { owner_kind, owner_id }) => {
      qc.invalidateQueries({ queryKey: ["evals", "batches", owner_kind, owner_id] });
      qc.invalidateQueries({ queryKey: ["evals", "dashboard"] });
    },
  });
}

/** `GET /evals/batches/:id` — batch detail, served (and partial) while the
    batch is still `"running"` (AC-17-19); polls every 2s (REQ-17) until it
    reaches a terminal status, mirroring `usePrRuns`'s `refetchInterval`. */
export function useEvalBatch(batchId: string | null | undefined) {
  return useQuery({
    queryKey: ["evals", "batch", batchId],
    queryFn: () => api.get<EvalBatchDetail>(`/evals/batches/${batchId}`),
    enabled: !!batchId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });
}

/** `GET /evals/batches?owner_kind&owner_id` — batch history (REQ-31). */
export function useEvalBatches(
  ownerKind: EvalOwnerKind | null | undefined,
  ownerId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["evals", "batches", ownerKind, ownerId],
    queryFn: () =>
      api.get<EvalBatchRecord[]>(
        `/evals/batches?owner_kind=${encodeURIComponent(ownerKind!)}&owner_id=${encodeURIComponent(ownerId!)}`,
      ),
    enabled: !!ownerKind && !!ownerId,
  });
}

/** `GET /evals/batches/compare?a&b` — two-batch comparison + version diff
    (REQ-34, 35, 36, 71). */
export function useEvalBatchComparison(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: ["evals", "batch-compare", a, b],
    queryFn: () =>
      api.get<EvalBatchComparison>(
        `/evals/batches/compare?a=${encodeURIComponent(a!)}&b=${encodeURIComponent(b!)}`,
      ),
    enabled: !!a && !!b,
  });
}

// ---- Dashboard (REQ-29, 30, 32, 33, 37, 71) ----

/** `GET /evals/dashboard` — one row per enabled agent (REQ-29, 30). */
export function useEvalDashboard() {
  return useQuery({
    queryKey: ["evals", "dashboard"],
    queryFn: () => api.get<EvalOwnerDashboard[]>("/evals/dashboard"),
  });
}

/** `GET /evals/dashboard/:agentId` — drill-in: metrics, deltas, alert, trend,
    runs (REQ-32, 33, 37, 71). */
export function useEvalOwnerDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["evals", "dashboard", agentId],
    queryFn: () => api.get<EvalOwnerDashboard>(`/evals/dashboard/${agentId}`),
    enabled: !!agentId,
  });
}

// ---- Reviews module — eval-draft (REQ-3, 4, 5) ----

/**
 * `GET /findings/:id/eval-draft` — the pre-filled draft for `Turn into eval
 * case` (AC-4, AC-5). Lives in the `reviews` module server-side, not `evals`,
 * so the query key is scoped by finding id alone (mirrors `usePrIntent`'s
 * "the resource IS the cache key" shape) rather than nested under `["evals",
 * …]`. The server answers `409` with a reason WHEN no stored diff exists for
 * the finding's file (AC-3) — that surfaces as an ordinary `ApiError` on
 * `error`, not a special case here; the caller reads `error.status`.
 *
 * `enabled` defaults to `true` on a non-null id — pass `enabled: false` until
 * the user actually activates `Turn into eval case`, since AC-2/AC-3 gate
 * that action being clickable in the first place and this call should not
 * fire before then.
 *
 * `decidedAs` IS part of the cache key, not a filter on it. The response body
 * depends on the finding's decision — `buildEvalDraft` stamps
 * `seeded_from: 'accepted' | 'dismissed'`, which is the only thing
 * `EvalCaseEditor` labels its POSITIVE/NEGATIVE banner from — so the finding
 * id alone does NOT identify this resource. Keyed by id alone, an
 * accept -> revert -> dismiss round trip re-enabled the query on the same key
 * and React Query served the accept-time draft from cache (the app sets
 * `staleTime: 30_000` in `lib/providers.tsx`), opening a POSITIVE editor for a
 * dismissed finding. Invalidating on the action mutation would not have been
 * enough either: a stale-but-present entry keeps `isSuccess`/`data` populated
 * during the background refetch, so a fast click still reads the old
 * polarity. A distinct key has no such window — the new decision starts with
 * `data: undefined`, which `turnIntoCaseState` already renders as disabled.
 */
export function useFindingEvalDraft(
  findingId: string | null | undefined,
  options?: { enabled?: boolean; decidedAs?: "accepted" | "dismissed" | null },
) {
  return useQuery({
    queryKey: ["eval-draft", findingId, options?.decidedAs ?? null],
    queryFn: () => api.get<EvalCaseDraft>(`/findings/${findingId}/eval-draft`),
    enabled: !!findingId && (options?.enabled ?? true),
  });
}
