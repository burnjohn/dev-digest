import type { MemoryItem, MemoryScope, MemoryKind, MemorySource } from '@devdigest/shared';
import type { MemoryRow } from './repository.js';

/**
 * A1 — memory pure helpers + API-facing DTO types (extracted from service.ts;
 * no behaviour change). Re-exported from service.ts to keep public names stable.
 */

/** API-facing memory DTO: the §6 MemoryItem plus row identity/timestamps. */
export interface MemoryDto extends MemoryItem {
  id: string;
  repo_id: string | null;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface RetrievedMemory extends MemoryDto {
  /** cosine distance (0 = identical). similarity = 1 - distance. */
  distance: number;
  similarity: number;
}

/** Map a persisted memory row to the API DTO. */
export function toDto(row: MemoryRow): MemoryDto {
  return {
    id: row.id,
    repo_id: row.repoId,
    content: row.content,
    scope: row.scope as MemoryScope,
    kind: row.kind as MemoryKind,
    confidence: row.confidence ?? 0,
    sources: (row.sources as MemorySource[] | null) ?? [],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
  };
}

/** Convert a cosine distance to a similarity score (1 - distance). */
export function similarityFromDistance(distance: number): number {
  return 1 - distance;
}
