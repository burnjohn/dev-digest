import type { Container } from '../../platform/container.js';
import type { MemoryScope, MemoryKind, MemorySource } from '@devdigest/shared';
import { MemoryRepository, type MemoryFilter } from './repository.js';
import { toDto, similarityFromDistance, type MemoryDto, type RetrievedMemory } from './helpers.js';
import { DEFAULT_CONFIDENCE, LEARNING_CONFIDENCE, LEARNING_DEFAULT_CONTEXT } from './constants.js';

/**
 * A1 — memory service. Business logic for the Memory Browser AND the reusable
 * cross-cutting helpers A2/A5 call:
 *   - `retrieveMemory(...)`   pgvector cosine top-k, scoped by workspace/repo
 *   - `learnFromFinding(...)` create a kind='learning' memory row from a finding
 *
 * Embeddings always go through the Embedder adapter (never a direct SDK call).
 *
 * DTO types + row mapping live in helpers.ts (re-exported here to keep public
 * names stable); literals live in constants.ts.
 */

export type { MemoryDto, RetrievedMemory };

export class MemoryService {
  private repo: MemoryRepository;

  constructor(private container: Container) {
    this.repo = new MemoryRepository(container.db);
  }

  /** Best-effort embedder resolution: returns null if no key configured. */
  private async tryEmbedder() {
    try {
      return await this.container.embedder();
    } catch {
      return null;
    }
  }

  private async embedOne(text: string): Promise<number[] | null> {
    const embedder = await this.tryEmbedder();
    if (!embedder) return null;
    const [vec] = await embedder.embed([text]);
    return vec ?? null;
  }

  async list(workspaceId: string, filter: MemoryFilter): Promise<MemoryDto[]> {
    const rows = await this.repo.list(workspaceId, filter);
    return rows.map(toDto);
  }

  /** Create a memory row, embedding its content via the Embedder adapter. */
  async create(
    workspaceId: string,
    input: {
      content: string;
      scope: MemoryScope;
      kind: MemoryKind;
      confidence?: number | null;
      sources?: MemorySource[];
      repoId?: string | null;
    },
  ): Promise<MemoryDto> {
    const embedding = await this.embedOne(input.content);
    const row = await this.repo.insert({
      workspaceId,
      repoId: input.repoId ?? null,
      scope: input.scope,
      kind: input.kind,
      content: input.content,
      embedding,
      confidence: input.confidence ?? DEFAULT_CONFIDENCE,
      sources: input.sources ?? [],
    });
    return toDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: { content?: string; scope?: MemoryScope; kind?: MemoryKind; confidence?: number },
  ): Promise<MemoryDto | undefined> {
    // re-embed if content changed
    let embedding: number[] | null | undefined;
    if (patch.content !== undefined) embedding = await this.embedOne(patch.content);
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
      ...(embedding !== undefined ? { embedding } : {}),
    });
    return row ? toDto(row) : undefined;
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.remove(workspaceId, id);
  }

  // ---------------------------------------------------------------------------
  // Reusable cross-cutting API (A2/A5 call these directly).
  // ---------------------------------------------------------------------------

  /**
   * Embed `query` and return the cosine top-k most-similar memory rows scoped by
   * workspace (and optionally repo + global rows). Bumps last_used_at on hits so
   * the freshness filter and curator can reason about recency. Returns [] if no
   * embedder is configured (graceful degradation).
   */
  async retrieveMemory(
    workspaceId: string,
    query: string,
    opts: { topK?: number; repoId?: string | null } = {},
  ): Promise<RetrievedMemory[]> {
    const embedding = await this.embedOne(query);
    if (!embedding) return [];
    const rows = await this.repo.searchByVector(workspaceId, embedding, opts);
    await this.repo.touch(rows.map((r) => r.id));
    return rows.map((r) => ({
      ...toDto(r),
      distance: r.distance,
      similarity: similarityFromDistance(r.distance),
    }));
  }

  /**
   * Create a `kind='learning'` memory row from a review finding. A2 wires the
   * finding "Learn" action button to this. The finding's text becomes the memory
   * content; the source PR is recorded for provenance (§7 acceptance).
   */
  async learnFromFinding(
    workspaceId: string,
    input: {
      content: string;
      repoId?: string | null;
      prNumber?: number | null;
      context?: string;
      scope?: MemoryScope;
      confidence?: number;
    },
  ): Promise<MemoryDto> {
    const sources: MemorySource[] = [
      { pr: input.prNumber ?? null, context: input.context ?? LEARNING_DEFAULT_CONTEXT },
    ];
    return this.create(workspaceId, {
      content: input.content,
      scope: input.scope ?? (input.repoId ? 'repo' : 'global'),
      kind: 'learning',
      confidence: input.confidence ?? LEARNING_CONFIDENCE,
      sources,
      repoId: input.repoId ?? null,
    });
  }
}
