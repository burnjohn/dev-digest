import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { MemoryScope, MemoryKind } from '@devdigest/shared';
import { DEFAULT_STALE_DAYS, DEFAULT_TOP_K } from './constants.js';

/**
 * A1 — memory data-access layer. The ONLY place that touches the `memory`
 * table. Every query is scoped by `workspaceId` (§11 tenancy guard).
 */

export type MemoryRow = typeof t.memory.$inferSelect;

export interface MemoryFilter {
  scope?: MemoryScope[];
  kind?: MemoryKind[];
  q?: string;
  /** When false, hide stale rows (last_used_at older than `staleDays`). */
  includeStale?: boolean;
  staleDays?: number;
  repoId?: string | null;
}

export interface InsertMemory {
  workspaceId: string;
  repoId?: string | null;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  embedding?: number[] | null;
  confidence?: number | null;
  sources?: unknown;
}

export class MemoryRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string, filter: MemoryFilter = {}): Promise<MemoryRow[]> {
    const where: SQL[] = [eq(t.memory.workspaceId, workspaceId)];
    if (filter.scope && filter.scope.length > 0) {
      where.push(inArray(t.memory.scope, filter.scope));
    }
    if (filter.kind && filter.kind.length > 0) {
      where.push(inArray(t.memory.kind, filter.kind));
    }
    if (filter.q && filter.q.trim()) {
      where.push(sql`${t.memory.content} ILIKE ${'%' + filter.q.trim() + '%'}`);
    }
    if (filter.repoId !== undefined) {
      where.push(
        filter.repoId === null
          ? sql`${t.memory.repoId} IS NULL`
          : eq(t.memory.repoId, filter.repoId),
      );
    }
    if (filter.includeStale === false) {
      const days = filter.staleDays ?? DEFAULT_STALE_DAYS;
      where.push(
        sql`(${t.memory.lastUsedAt} IS NULL OR ${t.memory.lastUsedAt} > now() - (${days}::int * interval '1 day'))`,
      );
    }
    return this.db
      .select()
      .from(t.memory)
      .where(and(...where))
      .orderBy(desc(t.memory.updatedAt));
  }

  async getById(workspaceId: string, id: string): Promise<MemoryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.id, id)));
    return row;
  }

  async insert(values: InsertMemory): Promise<MemoryRow> {
    const [row] = await this.db
      .insert(t.memory)
      .values({
        workspaceId: values.workspaceId,
        repoId: values.repoId ?? null,
        scope: values.scope,
        kind: values.kind,
        content: values.content,
        embedding: values.embedding ?? null,
        confidence: values.confidence ?? null,
        sources: values.sources ?? [],
        lastUsedAt: new Date(),
      })
      .returning();
    return row!;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: Partial<Pick<InsertMemory, 'content' | 'scope' | 'kind' | 'confidence' | 'embedding' | 'sources'>>,
  ): Promise<MemoryRow | undefined> {
    const [row] = await this.db
      .update(t.memory)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.id, id)))
      .returning();
    return row;
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.id, id)))
      .returning({ id: t.memory.id });
    return deleted.length > 0;
  }

  /**
   * Cosine top-k similarity search (pgvector `<=>`). Scoped by workspace, and
   * optionally by repo (repo-scoped + global rows). Bumps last_used_at on hits.
   */
  async searchByVector(
    workspaceId: string,
    embedding: number[],
    opts: { topK?: number; repoId?: string | null } = {},
  ): Promise<(MemoryRow & { distance: number })[]> {
    const topK = opts.topK ?? DEFAULT_TOP_K;
    const literal = `[${embedding.join(',')}]`;
    const where: SQL[] = [
      eq(t.memory.workspaceId, workspaceId),
      sql`${t.memory.embedding} IS NOT NULL`,
    ];
    if (opts.repoId) {
      // repo-scoped rows for this repo OR non-repo (global/team) rows
      where.push(sql`(${t.memory.repoId} = ${opts.repoId} OR ${t.memory.repoId} IS NULL)`);
    }
    const rows = await this.db
      .select({
        row: t.memory,
        distance: sql<number>`${t.memory.embedding} <=> ${literal}::vector`,
      })
      .from(t.memory)
      .where(and(...where))
      .orderBy(sql`${t.memory.embedding} <=> ${literal}::vector`)
      .limit(topK);
    return rows.map((r) => ({ ...r.row, distance: Number(r.distance) }));
  }

  async touch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(t.memory)
      .set({ lastUsedAt: new Date() })
      .where(inArray(t.memory.id, ids));
  }
}
