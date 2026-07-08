import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';

export type { ConventionRow, ConventionScanRow };

export interface InsertConventionScan {
  workspaceId: string;
  repoId: string;
  commitSha: string;
}

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  scanId: string;
  category: string;
  rule: string;
  evidencePath: string | null;
  evidenceSnippet: string | null;
  evidenceLine: number | null;
  evidenceLineEnd: number | null;
  evidenceUrl: string | null;
  modelConfidence: number;
  verifiedConfidence: number;
  dedupKey: string;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  // ---- scans ----------------------------------------------------------------

  async listScans(workspaceId: string, repoId: string): Promise<ConventionScanRow[]> {
    return this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(
          eq(t.conventionScans.workspaceId, workspaceId),
          eq(t.conventionScans.repoId, repoId),
        ),
      )
      .orderBy(desc(t.conventionScans.createdAt));
  }

  async getScan(workspaceId: string, scanId: string): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(
          eq(t.conventionScans.workspaceId, workspaceId),
          eq(t.conventionScans.id, scanId),
        ),
      );
    return row;
  }

  async insertScan(values: InsertConventionScan): Promise<ConventionScanRow> {
    const [row] = await this.db
      .insert(t.conventionScans)
      .values({ ...values, status: 'running' })
      .returning();
    return row!;
  }

  async updateScan(
    workspaceId: string,
    scanId: string,
    patch: Partial<{
      status: ConventionScanRow['status'];
      scannedFileCount: number;
      candidateCount: number;
      verifiedCount: number;
    }>,
  ): Promise<ConventionScanRow> {
    const [row] = await this.db
      .update(t.conventionScans)
      .set(patch)
      .where(
        and(
          eq(t.conventionScans.workspaceId, workspaceId),
          eq(t.conventionScans.id, scanId),
        ),
      )
      .returning();
    return row!;
  }

  // ---- conventions ----------------------------------------------------------

  async list(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)),
      )
      .orderBy(asc(t.conventions.category), desc(t.conventions.verifiedConfidence));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  /**
   * Upsert a batch of newly-verified convention candidates.
   *
   * Conflict target: the partial unique index on (repo_id, dedup_key) WHERE
   * dedup_key IS NOT NULL. On conflict we update evidence fields from the new
   * scan but deliberately SKIP status / accepted / edited_rule so the user's
   * accept/reject/edit decisions survive a re-scan.
   */
  async upsertBatch(values: InsertConvention[]): Promise<ConventionRow[]> {
    if (values.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        values.map((v) => ({
          workspaceId: v.workspaceId,
          repoId: v.repoId,
          scanId: v.scanId,
          category: v.category,
          rule: v.rule,
          evidencePath: v.evidencePath,
          evidenceSnippet: v.evidenceSnippet,
          evidenceLine: v.evidenceLine,
          evidenceLineEnd: v.evidenceLineEnd,
          evidenceUrl: v.evidenceUrl,
          modelConfidence: v.modelConfidence,
          verifiedConfidence: v.verifiedConfidence,
          confidence: v.verifiedConfidence, // keep legacy column in sync
          dedupKey: v.dedupKey,
          status: 'verified' as const,
          accepted: false,
        })),
      )
      .onConflictDoUpdate({
        target: [t.conventions.repoId, t.conventions.dedupKey],
        targetWhere: sql`dedup_key IS NOT NULL`,
        set: {
          scanId: sql`EXCLUDED.scan_id`,
          modelConfidence: sql`EXCLUDED.model_confidence`,
          verifiedConfidence: sql`EXCLUDED.verified_confidence`,
          confidence: sql`EXCLUDED.verified_confidence`,
          evidenceUrl: sql`EXCLUDED.evidence_url`,
          evidenceLine: sql`EXCLUDED.evidence_line`,
          evidenceLineEnd: sql`EXCLUDED.evidence_line_end`,
          evidenceSnippet: sql`EXCLUDED.evidence_snippet`,
          // status / accepted / editedRule intentionally NOT updated
        },
      })
      .returning();
  }

  async updateStatus(
    workspaceId: string,
    id: string,
    patch: { status: ConventionRow['status']; editedRule?: string | null },
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        status: patch.status,
        accepted: patch.status === 'accepted' || patch.status === 'edited',
        ...(patch.editedRule !== undefined ? { editedRule: patch.editedRule } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async listAccepted(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.status, ['accepted', 'edited']),
        ),
      )
      .orderBy(asc(t.conventions.category));
  }

  async insertSkillLinks(links: { conventionId: string; skillId: string }[]): Promise<void> {
    if (links.length === 0) return;
    await this.db.insert(t.conventionSkillLinks).values(links);
  }
}
