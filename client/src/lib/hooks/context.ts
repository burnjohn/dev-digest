/* hooks/context.ts — React Query hooks for SPEC-01 Project Context: discovery,
   preview, upload and the two `Context` tabs' replace-set attachment write.

   Route shapes (this task's own design — `server/src/modules/context/routes.ts`
   is wired by a sibling wave-3 task and must match these):
     GET  /repos/:repoId/context                 → ContextDocumentList
     GET  /repos/:repoId/context/preview?path=…   → ContextPreviewResponse
     POST /repos/:repoId/context/upload           → ContextDocument
     GET  /agents/:id/context?repo_id=…            → ContextAttachResponse
     GET  /skills/:id/context?repo_id=…            → ContextAttachResponse
     POST /agents/:id/context                      → ContextAttachResponse (body: ContextAttachRequest)
     POST /skills/:id/context                      → ContextAttachResponse (body: ContextAttachRequest)
   The owner-scoped routes mirror the existing `POST /agents/:id/skills`
   replace-set convention (`hooks/skills.ts`) rather than PUT.

   `client/INSIGHTS.md` 2026-08-25 — `api.get<T>()` is a plain cast with no
   runtime parse, so a drifted response resolves successfully and throws in
   render. Every query below parses its payload with the matching Zod schema
   from `@devdigest/shared` INSIDE `queryFn`, so a malformed response becomes an
   ordinary `isError` a caller can branch on, not a render-time throw. */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import {
  ContextAttachRequest,
  ContextAttachResponse,
  ContextDocument,
  ContextDocumentList,
  ContextPreviewResponse,
  ContextUploadRequest,
} from "@devdigest/shared";

// ---- Discovery (AC-1, AC-9) ----

/** `GET /repos/:repoId/context` — every discovered/uploaded document, the
    total, and whether the walk was bounded before the search roots were
    exhausted (AC-9). */
export function useContextDocuments(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-documents", repoId],
    queryFn: async () =>
      ContextDocumentList.parse(await api.get<unknown>(`/repos/${repoId}/context`)),
    enabled: !!repoId,
  });
}

// ---- Preview (AC-3) ----

/** `GET /repos/:repoId/context/preview` — a document's current text, read on
    demand. Disabled until both `repoId` and `path` are known (e.g. no row
    selected yet), so opening the page never fires a request with `path=undefined`. */
export function useContextPreview(
  repoId: string | null | undefined,
  path: string | null | undefined,
) {
  return useQuery({
    queryKey: ["context-preview", repoId, path],
    queryFn: async () =>
      ContextPreviewResponse.parse(
        await api.get<unknown>(`/repos/${repoId}/context/preview?path=${encodeURIComponent(path!)}`),
      ),
    enabled: !!repoId && !!path,
  });
}

// ---- Upload (AC-4, AC-31) ----

export interface UploadContextDocumentInput {
  repoId: string;
  filename: string;
  content: string;
}

/** `POST /repos/:repoId/context/upload` — stores the file under
    `~/.devdigest/context/<workspaceId>/<repoId>/` server-side (AC-4) and
    echoes the resulting document row. Invalidates the list so the new upload
    appears on the next render without a manual refresh. */
export function useUploadContextDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ repoId, filename, content }: UploadContextDocumentInput) => {
      const body: ContextUploadRequest = { filename, content };
      return ContextDocument.parse(
        await api.post<unknown>(`/repos/${repoId}/context/upload`, body),
      );
    },
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["context-documents", repoId] });
    },
  });
}

// ---- Attachment (AC-10 through AC-18) ----

/** An attachment's owner is either an agent's own `Context` tab or a linked
    skill's — REQ-18's traversal reads both, and each has its own route. */
export type ContextOwnerType = "agent" | "skill";

function ownerBasePath(ownerType: ContextOwnerType, ownerId: string): string {
  return ownerType === "agent" ? `/agents/${ownerId}/context` : `/skills/${ownerId}/context`;
}

/** `GET /{agents|skills}/:id/context?repo_id=…` — the owner's current
    attachment set for one repository, in stored position order. */
export function useContextAttachment(
  ownerType: ContextOwnerType,
  ownerId: string | null | undefined,
  repoId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["context-attachment", ownerType, ownerId, repoId],
    queryFn: async () =>
      ContextAttachResponse.parse(
        await api.get<unknown>(
          `${ownerBasePath(ownerType, ownerId!)}?repo_id=${encodeURIComponent(repoId!)}`,
        ),
      ),
    enabled: !!ownerId && !!repoId,
  });
}

const AUTOSAVE_DEBOUNCE_MS = 400;

export interface UseContextAutosaveOptions {
  ownerType: ContextOwnerType;
  ownerId: string | null | undefined;
  repoId: string | null | undefined;
  /**
   * The baseline this hook reverts to on a failed write, before any write of
   * its own has succeeded — typically `useContextAttachment(...).data?.paths`.
   * Read once per mount; a later change to the value does NOT retroactively
   * move the revert target of a write already in flight, which is what keeps
   * a slow first response from resurrecting a pre-edit state (NFR-5).
   */
  initialAcknowledged: string[];
  /**
   * Fired when the LATEST issued write fails — never for a write an
   * issued-after write has superseded (AC-13). Carries a message naming the
   * failure and the last paths the server is known to have persisted, so the
   * caller can revert its rendered rows to it (AC-35).
   */
  onError?: (message: string, revertTo: string[]) => void;
}

export interface UseContextAutosaveResult {
  /**
   * Schedule a replace-set write for the given COMPLETE ordered path list —
   * never a partial diff (NFR-5). Debounced 400 ms per owner (AC-13): call on
   * every checkbox toggle and every drop; three calls 100 ms apart collapse
   * into one write carrying the final list.
   */
  save: (paths: string[]) => void;
  /**
   * Immediately issue any pending debounced write. Called automatically on
   * unmount, so the last toggle before navigation is never silently lost;
   * exposed so a caller may also flush deliberately (e.g. before a manual
   * navigation it controls itself).
   */
  flush: () => void;
  /** True while at least one issued write has not yet settled. */
  isSaving: boolean;
}

/**
 * The autosave mutation behind both `Context` tabs (NFR-5).
 *
 * Three properties make this the whole weight of REQ-13/REQ-14/REQ-35, and
 * each is deliberate rather than incidental:
 *
 * 1. **A write never disturbs the rendered rows.** `isSaving` is the only
 *    state this hook exposes that a write's outcome touches; the caller goes
 *    on rendering the attached set and row order it already holds (client-held
 *    per `client/INSIGHTS.md` 2026-08-16), which is what keeps AC-14 true
 *    across a round trip. It DOES keep the `["context-attachment", …]` cache
 *    current — that is the cache the NEXT mount of the tab seeds itself from,
 *    and a mounted tab ignores it, so the two obligations do not collide.
 * 2. **Concurrent writes are resolved by ISSUE order, not RESOLVE order.**
 *    Every issued write captures a sequence number; a result is applied only
 *    if it is still the most recently issued one, so an earlier write's
 *    response resolving after a later one is discarded outright — success or
 *    failure alike.
 * 3. **A pending debounced write flushes on unmount** rather than being
 *    silently dropped by the timer never firing.
 */
export function useContextAutosave(options: UseContextAutosaveOptions): UseContextAutosaveResult {
  const { ownerType, ownerId, repoId, initialAcknowledged, onError } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string[] | null>(null);
  const seqRef = useRef(0);
  const inFlightRef = useRef(0);
  const acknowledgedRef = useRef<string[]>(initialAcknowledged);
  const [isSaving, setIsSaving] = useState(false);

  // Refs for values read inside a timer/promise callback that must always see
  // the LATEST prop, without re-creating `save`/`flush` (and so the pending
  // timer) every render.
  const ownerTypeRef = useRef(ownerType);
  ownerTypeRef.current = ownerType;
  const ownerIdRef = useRef(ownerId);
  ownerIdRef.current = ownerId;
  const repoIdRef = useRef(repoId);
  repoIdRef.current = repoId;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // `issue` is `useCallback(…, [])` so the pending debounce timer survives a
  // re-render; the query client goes in a ref like every other value it reads.
  const qc = useQueryClient();
  const qcRef = useRef(qc);
  qcRef.current = qc;

  const issue = useCallback((paths: string[]) => {
    const currentOwnerId = ownerIdRef.current;
    const currentRepoId = repoIdRef.current;
    if (!currentOwnerId || !currentRepoId) return;

    const seq = ++seqRef.current;
    inFlightRef.current += 1;
    setIsSaving(true);

    const body: ContextAttachRequest = { repo_id: currentRepoId, paths };
    api
      .post<unknown>(ownerBasePath(ownerTypeRef.current, currentOwnerId), body)
      .then((res) => {
        // A superseded write's success is discarded — the later issued write
        // is the one whose result governs the acknowledged baseline (AC-13),
        // and, by the same rule, the cache.
        if (seq !== seqRef.current) return;
        acknowledgedRef.current = paths;

        // Without this the attachment query keeps serving its PRE-EDIT paths
        // for the whole 30s `staleTime`, and because both `Context` tabs seed
        // their attached set once at mount (deliberately — AC-14), switching
        // owners and back reverts the checkbox. `setQueryData` rather than
        // `invalidateQueries`: it costs no extra request and the cache is
        // right the instant the write lands. Mirrors `useSetAgentSkills`.
        //
        // The echo is validated, but a malformed one is NOT an error: the
        // write itself succeeded, and a 200 on a replace-set means that exact
        // set persisted (the oversized case is a 422, i.e. the catch below),
        // so the sent `paths` are a sound fallback.
        const echo = ContextAttachResponse.safeParse(res);
        qcRef.current.setQueryData(
          ['context-attachment', ownerTypeRef.current, currentOwnerId, currentRepoId],
          echo.success ? echo.data : { repo_id: currentRepoId, paths },
        );

        // The `Used by N agents` counts (AC-7) move with every attach/detach,
        // so the listing is stale — but `refetchType: 'none'`: the tab holds
        // that query ACTIVE while you toggle, and `listForRepo` re-walks the
        // checkout to the 5,000-file bound and re-reads every document on each
        // GET. Marking it stale is enough; the Project Context page refetches
        // it on its next mount.
        qcRef.current.invalidateQueries({
          queryKey: ['context-documents', currentRepoId],
          refetchType: 'none',
        });
      })
      .catch((err: unknown) => {
        if (seq !== seqRef.current) return; // superseded — never surfaced
        const message = err instanceof Error ? err.message : "Failed to save context attachments";
        onErrorRef.current?.(message, acknowledgedRef.current);
      })
      .finally(() => {
        inFlightRef.current -= 1;
        if (inFlightRef.current <= 0) {
          inFlightRef.current = 0;
          setIsSaving(false);
        }
      });
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current == null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    const paths = pendingRef.current;
    pendingRef.current = null;
    if (paths != null) issue(paths);
  }, [issue]);

  const save = useCallback(
    (paths: string[]) => {
      pendingRef.current = paths;
      if (timerRef.current != null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const p = pendingRef.current;
        pendingRef.current = null;
        if (p != null) issue(p);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [issue],
  );

  // Flush whatever is pending when the tab closes/unmounts, rather than
  // dropping the last toggle before navigation.
  useEffect(() => {
    return () => flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { save, flush, isSaving };
}
