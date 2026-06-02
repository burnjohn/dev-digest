import type { Container } from '../../platform/container.js';
import type { CuratorMerge, CuratorResult } from '@devdigest/shared/contracts/observability';
import { eq, inArray } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { RunsRepository } from './repository.js';
import { DEFAULT_SIMILARITY, KEPT_CONFIDENCE_FALLBACK, KEPT_CONFIDENCE_FLOOR } from './constants.js';
import { asSources, cosine, dedupeSources, rank } from './helpers.js';

/**
 * A5 — cross-session memory curator (§7). Consolidates `memory` rows learned
 * across many review sessions: it clusters rows whose embeddings are
 * near-duplicates (cosine similarity ≥ threshold, same scope+kind), keeps the
 * highest-confidence / most-recent row, merges the others' provenance into it,
 * and removes the duplicates. Uses A1's stored embeddings (it never bypasses
 * the Embedder — embeddings are produced by A1's MemoryService on write).
 *
 * Exposed as a service + triggered by a job kind and an endpoint, so it can run
 * on a schedule (A6 cron) or on demand.
 */

interface MemRow {
  id: string;
  content: string;
  scope: string;
  kind: string;
  confidence: number | null;
  sources: unknown;
  createdAt: Date;
  embedding: number[] | null;
}

export class MemoryCurator {
  private repo: RunsRepository;
  constructor(private container: Container) {
    this.repo = new RunsRepository(container.db);
  }

  /**
   * Curate a workspace's memory. When `dryRun` is true, returns the proposed
   * merges without mutating anything.
   */
  async curate(
    workspaceId: string,
    opts: { threshold?: number; dryRun?: boolean } = {},
  ): Promise<CuratorResult> {
    const threshold = opts.threshold ?? DEFAULT_SIMILARITY;
    const dryRun = opts.dryRun ?? false;

    const rows = (await this.repo.memoryWithEmbeddings(workspaceId)) as unknown as MemRow[];
    const usable = rows.filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0);

    const merges: CuratorMerge[] = [];
    const consumed = new Set<string>();

    for (let i = 0; i < usable.length; i++) {
      const anchor = usable[i]!;
      if (consumed.has(anchor.id)) continue;
      const cluster: MemRow[] = [];
      for (let j = i + 1; j < usable.length; j++) {
        const other = usable[j]!;
        if (consumed.has(other.id)) continue;
        if (other.scope !== anchor.scope || other.kind !== anchor.kind) continue;
        const sim = cosine(anchor.embedding!, other.embedding!);
        if (sim >= threshold) {
          cluster.push(other);
          consumed.add(other.id);
        }
      }
      if (cluster.length === 0) continue;

      // Keep the strongest member of {anchor, ...cluster}: highest confidence,
      // tie-broken by most-recent createdAt.
      const members = [anchor, ...cluster];
      const keep = members.reduce((best, m) =>
        rank(m) > rank(best) ? m : best,
      );
      const mergedIds = members.filter((m) => m.id !== keep.id).map((m) => m.id);
      const mergedSources = dedupeSources(members.flatMap((m) => asSources(m.sources)));

      merges.push({
        kept_id: keep.id,
        merged_ids: mergedIds,
        content: keep.content,
        similarity: Math.min(
          ...cluster.map((c) => cosine(keep.embedding!, c.embedding!)),
        ),
      });

      if (!dryRun) {
        // Fold provenance + bump confidence on the kept row; delete the rest.
        await this.container.db
          .update(t.memory)
          .set({
            sources: mergedSources,
            confidence: Math.min(1, Math.max(keep.confidence ?? KEPT_CONFIDENCE_FALLBACK, KEPT_CONFIDENCE_FLOOR)),
            updatedAt: new Date(),
          })
          .where(eq(t.memory.id, keep.id));
        if (mergedIds.length > 0) {
          await this.container.db.delete(t.memory).where(inArray(t.memory.id, mergedIds));
        }
      }
    }

    return {
      scanned: usable.length,
      merges,
      removed: dryRun ? 0 : merges.reduce((n, m) => n + m.merged_ids.length, 0),
      dry_run: dryRun,
    };
  }

  /** Register the curator job (so A6 cron / an endpoint can enqueue it). */
  registerJobHandler(): void {
    if (this.handlerRegistered) return;
    this.handlerRegistered = true;
    this.container.jobs.register('memory_curate', async (payload) => {
      const p = (payload ?? {}) as { workspaceId: string; threshold?: number };
      if (!p.workspaceId) return;
      await this.curate(p.workspaceId, p.threshold ? { threshold: p.threshold } : {});
    });
  }
  private handlerRegistered = false;
}
