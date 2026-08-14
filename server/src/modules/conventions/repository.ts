import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow } from '../../db/rows.js';
import type { VerifiedCandidate } from './extract.js';

export interface UpdateConvention {
  accepted?: boolean;
  rule?: string;
  category?: string;
}

export interface ScanState {
  sampledFiles: number;
  updatedAt: Date;
}

/**
 * Conventions data-access. Owns `conventions` and `conventions_scan_state`.
 * Workspace-scoped throughout, mirroring `SkillsRepository`.
 */
export class ConventionsRepository {
  constructor(private db: Db) {}

  /**
   * Clone path for a repo, scoped to this workspace so one tenant can never
   * read another's clone. `null` covers both "no such repo here" and "repo
   * not cloned yet" — callers treat them the same (extraction can't run).
   */
  async getClonePath(workspaceId: string, repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row?.clonePath ?? null;
  }

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /**
   * Delete the not-yet-accepted candidates for a repo — called right before a
   * re-scan inserts fresh ones, so accepted decisions survive `Re-scan` and
   * stale pending candidates from a prior scan don't pile up.
   */
  async deletePending(workspaceId: string, repoId: string): Promise<void> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.accepted, false),
        ),
      );
  }

  /** Bulk-insert freshly-verified candidates as `accepted: false`. */
  async insertMany(
    workspaceId: string,
    repoId: string,
    candidates: VerifiedCandidate[],
  ): Promise<ConventionRow[]> {
    if (candidates.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        candidates.map((c) => ({
          workspaceId,
          repoId,
          category: c.category,
          rule: c.rule,
          evidencePath: c.evidencePath,
          evidenceStartLine: c.evidenceStartLine,
          evidenceEndLine: c.evidenceEndLine,
          evidenceSnippet: c.evidenceSnippet,
          confidence: c.confidence,
          accepted: false,
        })),
      )
      .returning();
  }

  /** Accept/reject toggle and/or rule/category edit — one generic partial update. */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.accepted !== undefined ? { accepted: patch.accepted } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Most recent scan's file count + timestamp, or `undefined` if never scanned. */
  async getScanState(repoId: string): Promise<ScanState | undefined> {
    const [row] = await this.db
      .select({ sampledFiles: t.conventionsScanState.sampledFiles, updatedAt: t.conventionsScanState.updatedAt })
      .from(t.conventionsScanState)
      .where(eq(t.conventionsScanState.repoId, repoId));
    return row;
  }

  async upsertScanState(repoId: string, sampledFiles: number): Promise<void> {
    await this.db
      .insert(t.conventionsScanState)
      .values({ repoId, sampledFiles })
      .onConflictDoUpdate({
        target: t.conventionsScanState.repoId,
        set: { sampledFiles, updatedAt: new Date() },
      });
  }
}
