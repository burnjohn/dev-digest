/* hooks/memory.ts — React Query hooks for the A1 Memory Browser (§12). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { MemoryScope, MemoryKind, MemorySource } from "@devdigest/shared";

/** Memory DTO returned by the API (MemoryItem + identity/timestamps). */
export interface MemoryDto {
  id: string;
  repo_id: string | null;
  content: string;
  scope: MemoryScope;
  kind: MemoryKind;
  confidence: number;
  sources: MemorySource[];
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface MemoryFilters {
  scope?: MemoryScope[];
  kind?: MemoryKind[];
  q?: string;
  freshness?: "all" | "fresh";
  repoId?: string;
}

function toQuery(f: MemoryFilters): string {
  const p = new URLSearchParams();
  if (f.scope?.length) p.set("scope", f.scope.join(","));
  if (f.kind?.length) p.set("kind", f.kind.join(","));
  if (f.q?.trim()) p.set("q", f.q.trim());
  if (f.freshness === "fresh") p.set("freshness", "fresh");
  if (f.repoId) p.set("repoId", f.repoId);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function useMemory(filters: MemoryFilters) {
  return useQuery({
    queryKey: ["memory", filters],
    queryFn: () => api.get<MemoryDto[]>(`/memory${toQuery(filters)}`),
  });
}

export interface CreateMemoryInput {
  content: string;
  scope: MemoryScope;
  kind: MemoryKind;
  confidence?: number;
  repo_id?: string | null;
}

export function useCreateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMemoryInput) => api.post<MemoryDto>("/memory", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memory"] }),
  });
}

export function useUpdateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<MemoryDto, "content" | "scope" | "kind" | "confidence">>;
    }) => api.patch<MemoryDto>(`/memory/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memory"] }),
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ deleted: string }>(`/memory/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memory"] }),
  });
}
