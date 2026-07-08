"use client";

/* hooks/context-docs.ts — React Query hooks for the Project Context page
   (browse/preview/folder-config surface, AC-8: no attach/detach here).
   Targets `context-docs` module's repo-scoped HTTP surface:
     GET    /repos/:id/context-docs                → ContextDocument[]
     GET    /repos/:id/context-docs/content?path=… → ContextDocContent
     PUT    /repos/:id/context-docs                 → ContextDocument (create/edit overlay)
     DELETE /repos/:id/context-docs                 → { reverted } (delete overlay)
     GET    /repos/:id/context-folders              → ContextFolders
     PUT    /repos/:id/context-folders               → ContextFolders

   NEW hooks, NEW query keys ("context-docs"/"context-folders") — do NOT
   resurrect the deleted useContextFiles/useReindexContext or the old
   ["context", repoId] key (see docs/plans/2026-07-02-project-context-folder.md §4). */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiFetch } from "../api";
import type {
  ContextDocument,
  ContextDocContent,
  ContextFolders,
  AgentContextDocLink,
  SkillContextDocLink,
} from "@devdigest/shared";

/** GET /repos/:id/context-docs → discovered documents (path, category, token_count, used_by_agents). */
export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-docs", repoId],
    queryFn: ({ signal }) => api.get<ContextDocument[]>(`/repos/${repoId}/context-docs`, { signal }),
    enabled: !!repoId,
  });
}

/** GET /repos/:id/context-folders → effective root-folder config (defaulted). */
export function useContextFolders(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context-folders", repoId],
    queryFn: ({ signal }) => api.get<ContextFolders>(`/repos/${repoId}/context-folders`, { signal }),
    enabled: !!repoId,
  });
}

/** PUT /repos/:id/context-folders → persist root-folder config (AC-21).
    Invalidates both context-folders and context-docs — a folder change alters discovery scope. */
export function useSetContextFolders(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (folders: string[]) =>
      api.put<ContextFolders>(`/repos/${repoId}/context-folders`, { folders }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["context-folders", repoId] });
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
    },
  });
}

/** GET /repos/:id/context-docs/content?path=… → a document's EFFECTIVE content
    (overlay if present, else clone) with its `source` (AC-23/AC-25). */
export function useContextDocContent(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context-docs", repoId, "content", path],
    queryFn: ({ signal }) =>
      api.get<ContextDocContent>(
        `/repos/${repoId}/context-docs/content?path=${encodeURIComponent(path!)}`,
        { signal },
      ),
    enabled: !!repoId && !!path,
  });
}

/** PUT /repos/:id/context-docs → create/edit an overlay document (AC-24/AC-27).
    Single upsert endpoint for both edit and create/upload. Invalidates the list
    and the specific doc's content query — AC-33 auto-refresh, no manual reload. */
export function useSaveContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string; body: string }) =>
      api.put<ContextDocument>(`/repos/${repoId}/context-docs`, input),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
      qc.invalidateQueries({ queryKey: ["context-docs", repoId, "content", input.path] });
    },
  });
}

/** DELETE /repos/:id/context-docs → remove an overlay (AC-34). Reverts to clone
    content if a clone file exists, else removes the doc; never touches the clone.
    Same invalidation as save. */
export function useDeleteContextDoc(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { path: string }) =>
      apiFetch<{ reverted: boolean }>(`/repos/${repoId}/context-docs`, {
        method: "DELETE",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["context-docs", repoId] });
      qc.invalidateQueries({ queryKey: ["context-docs", repoId, "content", input.path] });
    },
  });
}

/* ---- Agent / skill attachment hooks (Agent Editor Context tab, Skill editor
   "Project context to use" section — AC-6, AC-7, AC-9, AC-20). Attachments
   are stored as workspace-level, repo-agnostic PATHS ONLY (see
   docs/plans/2026-07-02-project-context-folder.md §4 "Attachment scoping
   model") — never bound to the repo used to browse/attach them. ---- */

/** GET /agents/:id/context-docs → this agent's ordered direct attachments. */
export function useAgentContextDocs(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context-docs", agentId],
    queryFn: ({ signal }) => api.get<AgentContextDocLink[]>(`/agents/${agentId}/context-docs`, { signal }),
    enabled: !!agentId,
  });
}

/** POST /agents/:id/context-docs → full-replace ordered attachment list (AC-20). */
export function useSetAgentContextDocs(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentPaths: string[]) =>
      api.post<AgentContextDocLink[]>(`/agents/${agentId}/context-docs`, { document_paths: documentPaths }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-context-docs", agentId] }),
  });
}

/** GET /skills/:id/context-docs → this skill's ordered direct attachments. */
export function useSkillContextDocs(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context-docs", skillId],
    queryFn: ({ signal }) => api.get<SkillContextDocLink[]>(`/skills/${skillId}/context-docs`, { signal }),
    enabled: !!skillId,
  });
}

/** POST /skills/:id/context-docs → full-replace ordered attachment list (AC-20). */
export function useSetSkillContextDocs(skillId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentPaths: string[]) =>
      api.post<SkillContextDocLink[]>(`/skills/${skillId}/context-docs`, { document_paths: documentPaths }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skill-context-docs", skillId] }),
  });
}
